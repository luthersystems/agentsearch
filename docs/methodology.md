# AgentSearch — methodology

## What AgentSearch indexes

Every day, a crawler walks three sources and merges the results:

- **a2aregistry.org** — the canonical A2A agent registry
- **GitHub** — code search across the topics `a2a`, `mcp-server`, `ai-agent`,
  `agent`, `langchain-agent`, `autogen`
- **punkpeye/awesome-mcp-servers** — community-maintained MCP server list

Agents with the same URL across sources are merged into one record; the
`sources[]` array feeds the Fame layer.

## Per-agent record

Every agent has: `name`, `url`, `description`, `capabilities[]`, `sources[]`,
`fetched_at`, and a `raw` payload (whatever the source returned — GitHub stars,
license, pushed_at, A2A skills, etc.).

## Blocker probe

After the crawl, every URL gets a live HTTP probe (HEAD → GET fallback, 6s
timeout). Status is classified as `alive` / `dead` / `timeout` / `error`. An
agent that fails three days in a row is eliminated.

In parallel, five static **viability gates**: `has_url`, `has_name`,
`has_description`, `not_placeholder`, `not_deprecated`. Any failure forces
Overall = 0.

## Quality layers

Each surviving agent is scored on four dimensions. Each rubric is a separate
prompt, compiled once into Python and run deterministically every day.

### Fame
`0.3·sources + 0.3·stars + 0.2·recency + 0.2·author`

Star buckets: 0–10 → 0, 100 → 0.5, 1k → 0.75, 10k+ → 1.0.
Recency: ≤30d → 1.0, ≤6mo → 0.7, ≤1y → 0.4, older → 0.

### Usability
Mean of 5 gates, each 0.2:
- `documentation` — description/doc URL/homepage explains what it does
- `license` — declared
- `auth_pricing` — auth scheme or pricing clearly stated
- `capabilities` — structured (not just marketing prose)
- `repository` — public source repo

### Functionality
`0.25·specificity + 0.20·consistency + 0.20·reliability + 0.15·speed + 0.20·scope`

- `specificity` — concrete vs vague hype
- `consistency` — capabilities match description
- `reliability` — uptime, recent commits, established author
- `speed` — live probe `speed_ms`
- `scope` — clear what it does and does not do

### Call Graph
`log(1 + in_degree) / log(1 + max_in_degree)`

Edges mined from URL mentions, name mentions, and A2A `delegates` /
`dependencies` / `relatedAgents` fields.

## Combined Overall

```
Overall = Blocker × (0.3·Fame + 0.3·Usability + 0.3·Functionality + 0.1·CallGraph)
```

Blocker weights: `alive` 1.0, `timeout` 0.5, `error` 0.3, `dead` 0.0.

## Search ranking

For a user query:

1. Embed the query with `all-MiniLM-L6-v2` (384-dim).
2. Shortlist by capability-vector similarity.
3. Judge each shortlist member with `claude-haiku-4-5` for query fit (0–1).
4. Rank by `final_score = query_fit × Overall`.

## See also

- Public scoring methodology with diagrams: <https://agentsearch.luthersystems.com/agent-discovery.pdf>
- Live stats page: <https://agentsearch.luthersystems.com/stats>
