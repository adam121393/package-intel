# Apify Actor image.
#
# The build context is the repository root, not apify-actor/, because the Actor
# imports the shared data layer from src/ — the same upstream clients and health
# algorithm the HTTP API and the MCP server use. Copying those modules into the
# Actor instead would create a second implementation of the score, and two
# copies drifting apart means the same package rates differently depending on
# which product you bought it through.
#
# Push with the context set accordingly:  apify push --dockerfile apify-actor/Dockerfile

FROM apify/actor-node:22 AS build
WORKDIR /usr/src/app

# Actor dependencies (the Apify SDK) plus the TypeScript toolchain.
COPY apify-actor/package.json ./
RUN npm install --include=dev --no-audit --no-fund

COPY apify-actor/tsconfig.json ./
COPY apify-actor/src ./src
# The shared layer, kept at the same relative depth the imports expect.
COPY src ../../src
COPY tsconfig.json ../../tsconfig.json

RUN npx tsc

FROM apify/actor-node:22
WORKDIR /usr/src/app
ENV NODE_ENV=production

COPY apify-actor/package.json ./
RUN npm --quiet set progress=false \
 && npm install --omit=dev --omit=optional --no-audit --no-fund \
 && npm cache clean --force

COPY --from=build /usr/src/app/dist ./dist

CMD ["node", "dist/apify-actor/src/main.js"]
