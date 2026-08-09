# Builds the MCP server, not the paid API.
#
# This repository holds two things: the x402 API service at the root, and the
# MCP server clients actually install, in mcp-client/. Directory indexers build
# from a Dockerfile — checked in, or inferred from the project structure — and
# inference here would find the root package (a Hono service needing PAY_TO and
# CDP credentials to start) and fail. A failed build costs distribution: the
# listing survives but stops appearing in search and categories. Hence this file.
#
# The result is a stdio MCP server, which is how the published npm package runs.
# It needs no configuration: the four free tools work with no wallet and no key.

FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so edits to source do not invalidate the install layer.
COPY mcp-client/package.json mcp-client/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY mcp-client/tsconfig.json ./
COPY mcp-client/src ./src
RUN npx tsc

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY mcp-client/package.json mcp-client/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY LICENSE ./

# Runs unprivileged: this process makes outbound HTTPS calls and, if a wallet key
# is supplied, signs payments. Nothing about it needs root.
USER node

# stdio transport — the MCP client speaks JSON-RPC over stdin/stdout, so nothing
# is exposed on a port and no CMD arguments are required.
ENTRYPOINT ["node", "dist/server.js"]
