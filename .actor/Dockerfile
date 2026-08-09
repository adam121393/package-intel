# Apify Actor image.
#
# The build context is the repository root, because the Actor imports the shared
# data layer from src/ — the same upstream clients and health algorithm the HTTP
# API and the MCP server use. Copying those into the Actor instead would create a
# second implementation of the score, and two copies drifting apart means the
# same package rates differently depending on which product you bought it
# through. That is why .actor/ lives at the root: Apify builds from the pushed
# directory, so the definition has to sit where the shared code is visible.
#
# The layout inside the image deliberately mirrors the repository, so the
# tsconfig that typechecks locally is the same one that compiles here.

FROM apify/actor-node:22 AS build
WORKDIR /usr/src/app

# Dependencies first so source edits do not invalidate the install layer.
COPY apify-actor/package.json apify-actor/package-lock.json ./apify-actor/
RUN cd apify-actor && npm ci --include=dev --no-audit --no-fund

# tsc with NodeNext decides ESM vs CommonJS per file from the nearest
# package.json. The base image ships one at /usr/src/app with no "type", which
# made the shared src/ compile as CommonJS while apify-actor/src compiled as ESM
# — the entry point then failed to import named exports from its own data layer,
# reported as a missing export rather than a module-format mismatch. The
# repository root declares "type": "module", so this restores that fact inside
# the image.
RUN printf '{"type":"module","private":true}' > package.json

COPY apify-actor ./apify-actor
COPY src ./src

# Removed explicitly: a stale dist copied in from the context would otherwise
# survive and be served instead of this build's output.
RUN cd apify-actor && rm -rf dist && npx tsc

FROM apify/actor-node:22
WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY apify-actor/package.json apify-actor/package-lock.json ./
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund && npm cache clean --force

COPY --from=build /usr/src/app/apify-actor/dist ./dist

# tsc preserves the source tree under dist because rootDir is the repository
# root, so the entry point keeps its apify-actor/src path.
CMD ["node", "dist/apify-actor/src/main.js"]
