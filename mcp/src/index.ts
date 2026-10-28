#!/usr/bin/env node
// AgentSearch MCP server.
// Speaks the Model Context Protocol over stdio and proxies tool calls to the
// public AgentSearch HTTP endpoints at https://agentsearch.luthersystems.com.
//
// Add to any MCP-compatible client (Claude Desktop, Claude Code, Cursor, …):
//
//   {
//     "mcpServers": {
//       "agentsearch": { "command": "npx", "args": ["-y", "@luthersystems/agentsearch"] }
//     }
//   }

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const BASE_URL = process.env.AGENTSEARCH_BASE_URL || "https://agentsearch.luthersystems.com";
const USER_AGENT = "agentsearch-mcp/0.1.0";

// ── Tool definitions ────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "search",
    description:
      "Search the AgentSearch index for AI agents and MCP servers matching a natural-language query. " +
      "Results are ranked by final_score = query_fit × agent_quality. " +
      "Use this when the user asks 'find me an agent that does X' or 'what MCP server can Y'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language description of what the agent should do." },
        limit: { type: "integer", minimum: 1, maximum: 25, default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "agent_details",
    description:
      "Get the full scored profile for one indexed agent (by name). Returns inventory data, layer scores " +
      "(Fame / Usability / Functionality / Call Graph), reasoning, and live blocker status.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Exact agent name as it appears in the index." },
      },
      required: ["name"],
    },
  },
  {
    name: "found_agent",
    description:
      "Live-score an arbitrary agent URL that may or may not be in the index. Crawls the URL, runs the " +
      "viability + probe gates, then scores Fame / Usability / Functionality via the same rubric prompts " +
      "the batch pipeline uses. Useful when the user mentions an agent you can't find in `search`.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Primary URL of the agent (homepage, GitHub repo, A2A card, …)." },
        name: { type: "string", description: "Display name (optional — defaults to the URL)." },
        query: { type: "string", description: "Optional user query, used for the search-match judge." },
      },
      required: ["url"],
    },
  },
  {
    name: "browse",
    description:
      "Paginated list of every indexed agent, ranked by overall quality. Use to skim the top of the index " +
      "or to explore systematically.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "integer", minimum: 1, default: 1 },
        page_size: { type: "integer", minimum: 1, maximum: 200, default: 100 },
      },
    },
  },
  {
    name: "stats",
    description:
      "Index-level statistics: total agents, source breakdown, license breakdown, top capability clusters, " +
      "and how many agents are reachable right now.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

type ToolName = (typeof TOOLS)[number]["name"];

// ── HTTP helpers ────────────────────────────────────────────────────────────
async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

// ── Argument schemas ────────────────────────────────────────────────────────
// Every tool argument is parsed here before it reaches fetch(). The MCP client
// is untrusted input: the JSON inputSchema above is advice to the model, not a
// check, so a client can send `page: "1/../../admin"` and it would land in the
// request path. Parsing with zod enforces the same types and bounds the
// inputSchema advertises, which also keeps the request on BASE_URL's API.
// (`url` in found_agent is sent in the JSON body, not fetched here; the
// AgentSearch backend validates and crawls it.)
const ARG_SCHEMAS = {
  search: z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  agent_details: z.object({ name: z.string().min(1) }),
  found_agent: z.object({
    url: z.string().url(),
    name: z.string().optional(),
    query: z.string().optional(),
  }),
  browse: z.object({
    page: z.number().int().min(1).default(1),
    page_size: z.number().int().min(1).max(200).default(100),
  }),
  stats: z.object({}),
} as const;

// ── Tool dispatch ───────────────────────────────────────────────────────────
async function callTool(name: ToolName, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "search": {
      const { query, limit } = ARG_SCHEMAS.search.parse(args);
      const data = await postJson("/api/search", { query, limit }) as { results?: unknown[] };
      return { query, results: (data.results ?? []).slice(0, limit ?? 10) };
    }
    case "agent_details": {
      const { name: agentName } = ARG_SCHEMAS.agent_details.parse(args);
      return getJson(`/api/agent/${encodeURIComponent(agentName)}`);
    }
    case "found_agent": {
      const { url, name: agentName, query } = ARG_SCHEMAS.found_agent.parse(args);
      return postJson("/api/found-agent", { url, name: agentName, query });
    }
    case "browse": {
      const { page, page_size } = ARG_SCHEMAS.browse.parse(args);
      return getJson(`/api/browse?page=${page}&page_size=${page_size}`);
    }
    case "stats": {
      ARG_SCHEMAS.stats.parse(args);
      return getJson("/api/stats");
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ── Server bootstrap ────────────────────────────────────────────────────────
const server = new Server(
  { name: "agentsearch", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// The tool name and the argument object are parsed too, so an unknown tool
// is refused with a clear error and only a plain object reaches callTool.
const TOOL_NAMES = TOOLS.map((t) => t.name) as [ToolName, ...ToolName[]];
const CALL_PARAMS = z.object({
  name: z.enum(TOOL_NAMES),
  arguments: z.record(z.unknown()).default({}),
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const { name, arguments: args } = CALL_PARAMS.parse(req.params);
    const result = await callTool(name, args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      isError: true,
      content: [{ type: "text", text: `agentsearch error: ${msg}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

// Stderr is reserved for human-readable diagnostics in MCP; never log to stdout.
console.error(`[agentsearch-mcp] connected · proxying to ${BASE_URL}`);
