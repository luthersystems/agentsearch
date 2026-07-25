# Container image for the AgentSearch MCP server (mcp/).
#
# The server speaks MCP over stdio and proxies tool calls to the public
# AgentSearch HTTP API at https://agentsearch.luthersystems.com. There are no
# credentials and no required environment variables, so the container starts
# and answers `tools/list` out of the box.
#
# This exists so directories that build from a Dockerfile (Glama, the Docker
# MCP Registry) can run introspection against the same code that is published
# to npm as @luthersystems/agentsearch by .github/workflows/npm-publish.yml.
#
#   docker build -t agentsearch-mcp .
#   docker run -i --rm agentsearch-mcp
#
# Point it at a different backend with -e AGENTSEARCH_BASE_URL=https://...

FROM node:24-alpine AS build
WORKDIR /app/mcp
# No package-lock.json is committed, so `npm install` (not `npm ci`) — this
# mirrors what the npm-publish workflow does.
COPY mcp/package.json mcp/tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY mcp/src ./src
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY mcp/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/mcp/dist ./dist
USER node
ENTRYPOINT ["node", "dist/index.js"]
