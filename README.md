# AgentSearch

The agent that helps agents find other agents.

[**agentsearch.luthersystems.com**](https://agentsearch.luthersystems.com) — a
daily-scored, curated index of AI agents and MCP servers. Searchable,
browseable, and callable by other agents.

This repository hosts the **open-source agent surfaces** for AgentSearch:

- [`mcp/`](./mcp) — Model Context Protocol server. Plug into Claude Desktop,
  Claude Code, Cursor, or any MCP client and call AgentSearch as a tool.
- [`agent-card/`](./agent-card) — A2A agent card (`agent.json`) for the
  a2aregistry.
- [`openapi/`](./openapi) — OpenAPI 3.1 spec for the public HTTP endpoints.
- [`docs/`](./docs) — Methodology, scoring rubric, and integration guides.

The scoring pipeline that powers the index lives in a separate repo
(`luthersystems/agent-discovery`).

## What does AgentSearch do?

Given a natural-language query like *"read invoice pdf"* it returns a ranked
list of agents and MCP servers that can actually do that. Each result has:

- A search-match score (`query_fit`, judged by `claude-haiku-4-5`)
- An agent-quality score (live HTTP reachability × weighted Fame / Usability /
  Functionality / Call-Graph)
- A combined `final_score = query_fit × agent_quality`

It also runs a live Google search for the same query and shows which Google
results are real agents (extracted + scored on the fly).

## Calling AgentSearch from your agent

### Via MCP (recommended)

```bash
npm install @luthersystems/agentsearch
# or:  npx @luthersystems/agentsearch
```

Add to your MCP client config (Claude Desktop, Claude Code, Cursor, …):

```json
{
  "mcpServers": {
    "agentsearch": { "command": "npx", "args": ["-y", "@luthersystems/agentsearch"] }
  }
}
```

Tools exposed:

- `search(query: string, limit?: number)` — ranked agents for a query
- `agent_details(name: string)` — full scored profile of one indexed agent
- `found_agent(url: string, name?: string, query?: string)` — live-score an
  arbitrary agent URL using the same rubric (works for Google-found agents)
- `browse(page?: number, page_size?: number)` — paginated list of all indexed
  agents, ranked by overall quality
- `stats()` — index summary (totals, top sources/licenses, capability clusters)

### Via HTTP

All endpoints are public, no auth required. See
[`openapi/openapi.json`](./openapi/openapi.json).

```bash
curl -X POST https://agentsearch.luthersystems.com/api/search \
  -H "content-type: application/json" \
  -d '{"query": "read invoice pdf"}'
```

### Via A2A

The agent card is at:

```
https://agentsearch.luthersystems.com/.well-known/agent.json
```

Submit URL to a2aregistry.org or load directly in any A2A-compliant client.

## License

MIT — see [`LICENSE`](./LICENSE).
