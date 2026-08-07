# Free tier + zero-config MCP server

**Date:** 2026-08-07
**Status:** approved, ready for implementation

## Problem

The MCP server — the only surface a coding agent actually installs — calls
`process.exit(1)` when `X402_PRIVATE_KEY` is absent (`src/mcp/server.ts:24`). A
first-time user must create a wallet, fund it with USDC on Base, and paste a hot
private key into their editor config before the tool does anything at all.

Every distribution channel worth pursuing (MCP Registry, Glama, Smithery, a
Claude Code skill, a GitHub Action) funnels users into that wall. Building more
channels before removing it just moves more people to the same bounce.

The service has been live on Base mainnet since 2026-08-07 and has served zero
external calls and zero payments, so there is no revenue at risk in changing the
pricing surface.

## Goals

1. `npx -y package-intel-mcp` works with no wallet, no API key, no config.
2. Raw package data is free; the consolidated score stays paid.
3. The free tier cannot get our upstream sources (npm, OSV, deps.dev) to rate-limit us.
4. The package is publishable to npm and submittable to the MCP Registry.

## Non-goals

Granular per-item tools (license/typosquat/tree/compare), differentiated paid
signals (maintainer abandonment, download trends, slopsquat detection),
per-call logging and `/stats`, the GitHub Action, and the pre-commit hook. Each
is its own sub-project. This one only removes the adoption wall.

## Design

### Free/paid split

`src/catalog.ts` is the single source of truth behind three consumers: the x402
payment middleware, the `/.well-known/x402` manifest, and the Bazaar discovery
declarations. Deleting an entry to make it free would also delete it from
discovery, so instead each entry gains a tier:

```ts
tier: "free" | "paid"
```

- **paid** — included in the payment middleware route map, advertised in the
  manifest with its price, carries a Bazaar discovery declaration.
- **free** — excluded from the payment map, advertised in the manifest with
  `"price": "free"` and no `accepts` block, no Bazaar declaration (the Bazaar
  only catalogs payable resources).

| Endpoint | Before | After |
|---|---|---|
| `GET /v1/package/:ecosystem/:name` | $0.005 | free |
| `GET /v1/vulns/:ecosystem/:name` | $0.01 | free |
| `GET /v1/downloads/:ecosystem/:name` | $0.002 | free |
| `GET /v1/deps/:ecosystem/:name` | $0.02 | free |
| `GET /v1/health/:ecosystem/:name` | $0.01 | **paid** |
| `POST /v1/batch` | $0.02 | **paid** |

`price` becomes optional on free entries; `tier` is required so a new entry
cannot default into being free by omission.

**Known weakness.** Once snapshot and vulns are free, the health score is
reproducible by any caller: `src/domain/health.ts` is a ~100-line deterministic
heuristic over exactly those two inputs. The paid tier is therefore thin until
the differentiation sub-project adds signals the free public APIs do not carry.
This is an accepted, temporary trade: adoption is the binding constraint and
current revenue is zero.

### Rate limiting

New `src/rateLimit.ts`. In-memory token bucket, applied to free routes only —
paid routes are limited by their price.

- 60 requests/minute and 2000/day per client IP.
- Exceeding either returns `429` with `Retry-After` and a message naming the
  paid tier as the unmetered alternative.
- Buckets live in an LRU-bounded map (cap 10,000 IPs) so forged or spread
  source addresses cannot grow it without bound.
- State is per-process and resets on restart. Acceptable: the limit exists to
  protect upstream sources from a runaway loop, not to enforce a quota.

Client IP is not currently visible to the origin — `src/proxy-worker.ts:29`
strips `cf-connecting-ip`. The proxy will re-emit it as `x-stable-ip` before
stripping, mirroring the existing `x-stable-host` mechanism. The server reads
`x-stable-ip` and falls back to the socket address for direct/local requests.
A request arriving through the proxy without `x-stable-ip` is treated as a
single shared bucket rather than being allowed through unlimited.

Deploying the proxy change reintroduces the 1–3 minute window in which some
edge locations still run the previous Worker version.

### MCP server

`src/mcp/server.ts` stops exiting when no key is present.

- **No wallet:** registers `package_snapshot`, `package_vulns`, `package_deps`,
  `package_downloads`.
- **Wallet present:** additionally registers `package_health` and
  `package_batch_health`.
- An invalid (non-parseable) key is a hard error rather than a silent downgrade
  to free mode — that combination would otherwise look like the paid tools
  vanishing for no reason.
- Free tool responses carry a one-line `_upgrade` hint naming `package_health`
  and how to enable it, emitted **once per process** to avoid per-call token
  bloat.
- All tools declare `readOnlyHint: true`.

### Packaging

A new `mcp-client/` directory with its own `package.json`, published as
`package-intel-mcp` (verified available on npm 2026-08-07). The root package
depends on `hono`, `@hono/node-server`, `@x402/hono`, `@coinbase/x402` and
`lru-cache`, none of which a buyer needs; publishing the root would make every
`npx` install pull the whole server stack. `src/mcp/server.ts` imports nothing
from `src/`, so it lifts out cleanly.

- `bin` → `dist/server.js`, with a `#!/usr/bin/env node` shim.
- Dependencies: `@modelcontextprotocol/sdk`, `@x402/axios`, `@x402/evm`,
  `axios`, `viem`, `zod`.
- `engines: { node: ">=20.12" }` — the code uses `process.loadEnvFile`.
- `files: ["dist"]`, verified with `npm pack --dry-run`.
- Package README: one-line install, Claude Desktop / Cursor config, and a
  copy-paste `AGENTS.md` block, since agent instruction files are what produce
  recurring invocation.
- `server.json`'s `YOUR_GITHUB_USERNAME` placeholders are filled once a GitHub
  remote exists. The repo is currently local-only; MCP Registry submission
  proves ownership through GitHub and is blocked until it is pushed.

Publishing is a separate, explicit step requiring the user's `npm login`. The
name and version are permanent once released.

## Testing

Vitest, added to the root package. Unit tests where the logic is real:

- **Rate limiter** — refill over time, minute and day limits enforced
  independently, LRU eviction, distinct IPs isolated.
- **Catalog derivation** — every paid entry appears in the payment map and no
  free entry does; the manifest lists both with correct price/`accepts` shape.
  A mistake here either charges for a free route or serves a paid one for
  nothing, so it is asserted directly.

End-to-end verification by script, against a locally running server:

1. `GET /v1/vulns/npm/express` → 200 with no payment header.
2. `GET /v1/health/npm/express` → 402.
3. 61 rapid free calls → the last returns 429 with `Retry-After`.
4. MCP server started with no `X402_PRIVATE_KEY` → process stays alive and
   `tools/list` returns exactly the four free tools.
5. `npm pack --dry-run` in `mcp-client/` → contains `dist/` and nothing else.

Check 4 is the regression that matters most: it is the wall this work removes.

## Rollout

1. Server changes + tests, verified locally.
2. Deploy the proxy change, accept the propagation window, re-verify publicly.
3. Package, `npm pack --dry-run`, then publish on the user's go-ahead.
4. GitHub remote + `server.json` — prerequisite for MCP Registry, tracked
   separately.
