#!/usr/bin/env node
// AgentSearch MCP server.
// Speaks the Model Context Protocol over stdio and proxies tool calls to the
// public AgentSearch HTTP endpoints at https://agentsearch.luthersystems.com.
//
// Add to any MCP-compatible client (Claude Desktop, Claude Code, Cursor, …):
//
//   {
//     "mcpServers": {
//       "agentsearch": { "command": "npx", "args": ["-y", "@agentsearch/mcp"] }
//     }
//   }

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

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

// ── Tool dispatch ───────────────────────────────────────────────────────────
async function callTool(name: ToolName, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "search": {
      const { query, limit } = args as { query: string; limit?: number };
      const data = await postJson("/api/search", { query, limit }) as { results?: unknown[] };
      return { query, results: (data.results ?? []).slice(0, limit ?? 10) };
    }
    case "agent_details": {
      const { name: agentName } = args as { name: string };
      return getJson(`/api/agent/${encodeURIComponent(agentName)}`);
    }
    case "found_agent": {
      const { url, name: agentName, query } = args as { url: string; name?: string; query?: string };
      return postJson("/api/found-agent", { url, name: agentName, query });
    }
    case "browse": {
      const { page = 1, page_size = 100 } = args as { page?: number; page_size?: number };
      return getJson(`/api/browse?page=${page}&page_size=${page_size}`);
    }
    case "stats": {
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

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    const result = await callTool(name as ToolName, args as Record<string, unknown>);
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
