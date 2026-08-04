# Package & Dependency Intelligence API (x402)

A pay-per-call API selling npm/PyPI package health, dependency-graph, and vulnerability
data to AI coding agents over the [x402](https://github.com/x402-foundation/x402) payment
protocol — plus an MCP server so agents in Claude Desktop/Cursor can call it and pay
automatically.

Defaults to **Base Sepolia testnet** via the free public facilitator. Going to mainnet is
an explicit config change (see [Going to mainnet](#going-to-mainnet)).

## Endpoints

| Endpoint | Method | Price | Returns |
|---|---|---|---|
| `/v1/package/:ecosystem/:name` | GET | $0.005 | Consolidated snapshot |
| `/v1/health/:ecosystem/:name` | GET | $0.01 | Health/risk score 0-100 |
| `/v1/vulns/:ecosystem/:name` | GET | $0.01 | Known vulnerabilities (OSV.dev) |
| `/v1/deps/:ecosystem/:name` | GET | $0.02 | Dependency graph (deps.dev) |
| `/v1/downloads/:ecosystem/:name` | GET | $0.002 | Download counts |
| `/v1/batch` | POST | $0.02 | Batched health scores (≤50 packages) |

`:ecosystem` is `npm` or `pypi`. Free/unpaid: `/healthz`, `/v1/sample` (canned example
response), `/.well-known/x402` (discovery manifest).

Prices, descriptions, and discovery metadata all come from `src/catalog.ts` — edit there
and the payment middleware, manifest, and Bazaar declarations stay in sync.

## Local setup (testnet)

```bash
npm install
npm run gen-wallet
```

`gen-wallet` prints two **testnet-only** keypairs — never fund these with real assets:

- **Seller** — put its address in `.env` as `PAY_TO` (where payments land).
- **Buyer** — put its private key in `.env` as `BUYER_PRIVATE_KEY` (used by the test
  script to simulate a paying agent).

Copy `.env.example` to `.env` and fill those in. Then fund the **buyer** with Base Sepolia
USDC at [faucet.circle.com](https://faucet.circle.com) (select Base Sepolia; no account
needed). No testnet ETH is required — x402's `exact` scheme uses EIP-3009, so the buyer
only signs off-chain and the facilitator pays gas.

```bash
npm run dev
```

Verify: `curl http://localhost:4021/healthz` → 200, and
`curl -i http://localhost:4021/v1/health/npm/express` → 402 with payment instructions.

## Test the payment flow

```bash
npm run test-buyer                              # GET /v1/health/npm/express (default)
npm run test-buyer -- /v1/deps/npm/express
npm run test-buyer -- /v1/batch
```

On Git Bash/Windows, prefix with `MSYS_NO_PATHCONV=1` so the leading `/` isn't rewritten
into a Windows path.

A request for a nonexistent package returns 404 **without charging** — the x402 middleware
skips settlement entirely on any 4xx/5xx response, so failures are free.

## MCP server (how agents consume this)

`src/mcp/server.ts` is a stdio MCP server that runs on the *buyer's* machine, exposing six
tools (`package_health`, `package_vulns`, `package_deps`, `package_snapshot`,
`package_downloads`, `package_batch_health`). Each tool calls the paid HTTP API and, on a
402, signs a USDC payment from the configured wallet and retries — the agent just sees data.

Add to Claude Desktop (`claude_desktop_config.json`) or Cursor (`mcp.json`):

```json
{
  "mcpServers": {
    "package-intel": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "cwd": "/absolute/path/to/project",
      "env": {
        "API_URL": "https://api.yourdomain.com",
        "NETWORK": "eip155:8453",
        "X402_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

`X402_PRIVATE_KEY` is the *agent operator's* wallet, funded with USDC on `NETWORK`. Use a
dedicated low-balance wallet — it is a hot key that spends automatically.

## Coinbase CDP setup

Two **different** CDP credentials, easy to conflate:

| Credential | Needed for |
|---|---|
| `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` | The **facilitator** — verifying and settling payments |
| `CDP_WALLET_SECRET` | The **wallet SDK** — creating/controlling CDP-managed accounts |

Receiving payments needs only a public address. The server never holds key material to
get paid — `CDP_WALLET_SECRET` is only for `npm run cdp-wallet`.

```bash
# 1. Add CDP_API_KEY_ID + CDP_API_KEY_SECRET to .env, then:
npm run cdp-check          # verifies keys, prints which networks CDP actually serves

# 2. Add CDP_WALLET_SECRET, then create a TEE-backed receiving account:
npm run cdp-wallet                  # prints an address to use as PAY_TO
npm run cdp-wallet -- --faucet      # also request Base Sepolia test funds
```

`cdp-check` exists because CDP's docs list supported networks as "Base, Polygon, Arbitrum,
World, Solana" without saying whether Base *Sepolia* is included, and `/supported` requires
auth. It answers that empirically and tells you whether the testnet rehearsal below is
possible.

### Rehearsing the CDP path on testnet

If `cdp-check` reports Base Sepolia is supported, set `USE_CDP_FACILITATOR=true` while
leaving `NETWORK=eip155:84532`. You then exercise the real CDP credentials and settlement
path against **test** funds. If it isn't supported, leave the flag unset — the CDP path
will first run on mainnet, so make that first payment a small one.

## Going to mainnet

1. **Receiving wallet** — use a dedicated address (ideally from `npm run cdp-wallet`), never
   a personal wallet. Only the public address goes in `PAY_TO`.
2. **Set `NETWORK=eip155:8453`.** The server switches to the CDP facilitator automatically
   and refuses to boot without CDP keys, rather than silently using a testnet facilitator.
3. **Set `PUBLIC_URL`** to the real origin so the manifest advertises reachable URLs.
4. **Deploy** (below), then make 2–3 real settled payments — the CDP Bazaar only catalogs a
   service after its first successful settlement.

Start small and confirm settlement on [BaseScan](https://basescan.org) against your `PAY_TO`
address before promoting the endpoint anywhere.

## Deploy (Railway)

`railway.json` is included (Nixpacks, `npm start`, `/healthz` health check). Push the repo,
create a Railway project from it, and set the environment variables from `.env.example` in
Railway's variables UI — **not** in a committed file. Point uptime monitoring at `/healthz`.

## Getting listed

- **CDP Bazaar** — automatic once on mainnet via the CDP facilitator, after the first
  settled payment. Each route already declares discovery metadata with a *valid* sample
  input (`npm`/`express`); this matters because the Bazaar probes with that input and only
  indexes endpoints that answer **402** — a placeholder ecosystem would 400 and never list.
- **`/.well-known/x402`** — already served, for agentic.market / x402scan / x402-list.
- **MCP registries** — publish to the official MCP Registry, then Glama, Smithery, PulseMCP.

## Notes

- **Caching:** in-process LRU with TTLs from 1h (vulns) to 24h (downloads/deps). On upstream
  failure a stale value is served with `stale: true` rather than erroring.
- **Validation before payment:** unsupported ecosystems 400 in middleware *before* the
  payment check, so they're never charged.
- **Version-scoped vulnerabilities:** health scores query OSV for the resolved current
  version. Querying without a version returns every advisory in the package's history,
  which badly misrepresents maintained packages.
- **pypistats rate limits** aggressively (429 after a couple of rapid calls). Download
  counts are best-effort: a failure omits that field rather than failing the request. Warm
  the cache for popular packages if this matters.
- The health score in `src/domain/health.ts` is a documented v1 heuristic — tune the weights
  as real usage data arrives.
