# @luthersystems/agentsearch

Model Context Protocol server for [AgentSearch](https://agentsearch.luthersystems.com).

Lets any MCP-compatible client (Claude Desktop, Claude Code, Cursor, …) search a
daily-scored, curated index of AI agents and MCP servers — ranked by
reachability, usability, functionality, and per-query relevance.

## Install & run

```bash
npx -y @luthersystems/agentsearch
```

## Add to your MCP client

`~/Library/Application Support/Claude/claude_desktop_config.json` (or the
equivalent location for your client):

```json
{
  "mcpServers": {
    "agentsearch": { "command": "npx", "args": ["-y", "@luthersystems/agentsearch"] }
  }
}
```

## Tools exposed

| Tool | Description |
|---|---|
| `search` | Ranked agents for a natural-language query (final_score = query_fit × agent_quality) |
| `agent_details` | Full scored profile of one indexed agent |
| `found_agent` | Live-score any arbitrary agent URL using the same rubric |
| `browse` | Paginated list of every indexed agent, ranked by overall quality |
| `stats` | Index-level summary stats |

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `AGENTSEARCH_BASE_URL` | `https://agentsearch.luthersystems.com` | Override to point at a self-hosted instance |

## License

MIT
