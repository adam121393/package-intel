# Build Spec: An x402 Pay-Per-Call "Package & Dependency Intelligence" API for AI Coding Agents

> **What this document is.** A complete, self-contained build brief you can paste to an AI coding model (e.g., Claude Fable 5) to build one well-engineered x402 pay-per-call endpoint that sells software-package/dependency intelligence to autonomous AI agents. It contains the market rationale, exact protocol mechanics, the recommended stack with code, upstream data sourcing with ToS analysis, deployment, wallet setup, go-to-market, and honest risk caveats. Verified facts are separated from estimates.

---

## TL;DR

- **Build a "Package & Dependency Intelligence" API** (npm/PyPI download trends + dependency graph + health/risk score + known-vulnerability lookup), on **Node.js/TypeScript + Hono**, priced **$0.002–$0.02 USDC per call on Base mainnet** via the **Coinbase CDP facilitator** (gasless, Bazaar auto-listing), also exposed as an **MCP server**. This vertical is essentially unserved on x402 today while DeFi/crypto data, web search, and lead enrichment are crowded — and it plays directly to your developer-tools background with permissive upstream ToS and zero PII.
- **The money is real but small.** x402 is past the wash-trading phase but still tiny: ~$1.11M in genuine 30-day volume across 3.69M transactions (~$0.30 avg/call, per x402 Inc.'s x402scan analysis), spread thin across a long tail where even the #1 service (StableEnrich) earned only ~$3,120/month. Realistic single-endpoint earnings: **~$2–15/month conservative, ~$30–120/month moderate, ~$300–800/month optimistic** in year one. Treat this as a cheap, high-optionality learning bet, not income replacement.
- **Do it because the cost is trivial and the option value is high.** ~$5–10/month hosting, permissive/free upstream APIs, and you learn the entire agentic-payments stack while planting a flag in a category before it's crowded. The report gives you a day-1/week-1/month-1 checklist to ship it.

---

## Key Findings

1. **x402 has exited the demo/wash-trading phase but remains economically small.** As of July 15, 2026, x402scan reported 194.6M cumulative transactions, $52.3M total volume, 842.8K unique buyers, 217.8K unique sellers. On a trailing-30-day basis (May 2026) genuine activity was ~3.69M transactions / ~$1.11M volume / ~$0.30 average per call (x402 Inc./Katomasa, from x402scan data). Earlier, on March 11, 2026, CoinDesk reported the protocol processed "only about $28,000 in daily volume, much of it from testing and 'gamed' transactions rather than real commerce," with an Artemis analyst calling the boom "still mostly a mirage" (~131,000 daily txns averaging ~$0.20). The trend since: volume down ~77% from the Nov-2025 speculative peak, but transaction counts recovering — i.e., the noise (PING memecoin farming) washed out and steady low-value API metering remains.

2. **Real demand concentrates in two clusters: machine-readable data for agents, and LLM/inference/execution gateways.** Top services by volume are data-enrichment and data aggregators (StableEnrich, BlockRun, HYRE/DeFi intel, twit.sh). Category share (one analysis): data services ~31%, AI/LLM ~25%, blockchain infra ~15%. Pricing distribution: ~76% of services price at ≤$0.10; ~69% sit in the $0.01–$0.10 band; median per-call ≈ $0.028 (Coinbase, Apr 2026); a separate directory (x402-list) reported median $0.005.

3. **"Package/dependency/code intelligence" is an unserved niche.** A dedicated competitive scan found no standalone x402 product selling npm/PyPI health, dependency graphs, or package risk scores. Coverage is incidental: one multi-purpose provider (2s.io) bundles 2 "registry (npm & PyPI)" endpoints + 14 GitHub + 16 security endpoints at ~$0.001 each; one standalone CVE API (cve.hugen.tokyo) at $0.01/call on Base. The concept is proven off-x402 (DepScope.dev offers exactly this but free; Apify hosts npm/PyPI/OSV scrapers but not on x402). No x402 directory even has a "developer tooling" category yet — a signal the niche is uncontested.

4. **The stack is mature enough to build on today.** x402 v2 is the current spec (CAIP-2 network IDs, `PAYMENT-REQUIRED`/`PAYMENT-SIGNATURE` headers). Official TypeScript SDKs (`@x402/core`, `@x402/evm`, `@x402/express`, `@x402/hono`, `@x402/mcp`, `@x402/extensions`) and Python (`x402[fastapi]`/`x402[flask]`) are live and versioned. The CDP facilitator supports Base, Polygon, Arbitrum, World, Solana with a free tier (first 1,000 settled payments/month, then $0.001 per settled payment — pricing effective Jan 1, 2026 per Coinbase Developer Platform) and gasless USDC via EIP-3009.

5. **Upstream data for this vertical is permissively licensed and free.** deps.dev (Google) states in its README: "Use of the deps.dev API is subject to the Google API Terms of Service. Clients are expressly permitted to cache data served by the API." OSV.dev is free, no API key, MIT-licensed data; the npm registry + downloads API is free with no formal rate limit ("be polite"); PyPI stats via public endpoints. This avoids the PII/compliance burden of lead-enrichment verticals and avoids ToS conflicts that plague reselling of proprietary data.

---

## Details

### A. Market / Opportunity Validation

**Ecosystem state (verified figures, with sources dated).**

| Metric | Value | As of | Source |
|---|---|---|---|
| Cumulative transactions | 194.6M | Jul 15, 2026 | x402scan |
| Total volume | $52.3M | Jul 15, 2026 | x402scan |
| Unique buyers | 842.8K | Jul 15, 2026 | x402scan |
| Unique sellers | 217.8K | Jul 15, 2026 | x402scan |
| 30-day txns / volume | 3.69M / $1.11M | May 2026 | x402 Inc. (x402scan-derived) |
| Avg per call (30d) | ~$0.30 ($1.11M ÷ 3.69M) | May 2026 | x402 Inc. |
| Buyer:seller ratio | ~4.4:1 | May 2026 | x402 Inc. |
| Cumulative (Coinbase) | 69,000 active agents, 165M tx, ~$50M | late Apr 2026 | Coinbase (via Eco.com) |
| Daily volume, "much test/gamed" | ~$28,000 (~131k txns @ ~$0.20) | Mar 11, 2026 | CoinDesk / Artemis |
| Base share of volume | ~85–90%+ | Apr 2026 | Base Foundation / x402scan |

**Distinguishing real usage from wash/test.** The consensus across independent sources: the Nov–Dec 2025 spike was largely PING memecoin farming ("pay 1 USDC to mint"), and wallet retention collapsed from ~87% to ~5% when that faded (Chainalysis/Datawallet). Since then, volume shrank but transaction counts recovered — read as noise removal, not collapse. Still treat headline cumulative numbers with skepticism; the ~$1.11M genuine monthly figure is the honest denominator for sizing. A July 2026 independent probe (PulseFeed) found ~47% of "listed-healthy" endpoints across catalogs actually return a valid x402 challenge — roughly half of listings are dead/broken.

**Underserved-niche analysis.** Crowded: DeFi/crypto data, web search/scraping, lead/contact enrichment, LLM gateways, media generation. Sparse/unserved: **software supply-chain & package intelligence for coding agents.** Coding agents (Claude Code, Cursor, Copilot Workspace, autonomous SWE agents) are among the fastest-growing agent classes and continuously need: "is this package healthy/maintained/safe?", "what's the latest version?", "what depends on what?", "any CVEs in this version?". Today they either don't have a payable tool for this or must wire up several free APIs themselves. A single consolidated, agent-optimized endpoint is a natural pay-per-call fit.

**Earnings math (estimates — clearly labeled).** Assume $0.01/call blended price. The ecosystem average is ~$0.30/call but that's inflated by high-value reasoning/inference calls; data endpoints cluster at $0.001–$0.02.

- **Conservative:** 200–1,500 calls/month → **$2–15/month.** (Realistic for an unpromoted new endpoint; matches the "everyone is thin" reality where the top service, StableEnrich, made ~$3,120/mo across 108,000 transactions and the long tail makes cents.)
- **Moderate:** 3,000–12,000 calls/month → **$30–120/month.** Requires active listing on all registries + being genuinely useful + some organic agent discovery.
- **Optimistic:** 30,000–80,000 calls/month → **$300–800/month.** Requires becoming a default tool in one or more agent frameworks/skill packs, or a viral moment. Rare in year one.

Be honest: **this is not meaningful income at current ecosystem scale.** Its value is optionality (if agent commerce 10–100×'s, an entrenched niche endpoint compounds) plus learning the full stack cheaply.

**Competitive landscape (verified).** 2s.io ("everything API," 575+ endpoints, $0.001+ each, includes 2 npm/PyPI registry + 14 GitHub + 16 security endpoints on Base/Solana). cve.hugen.tokyo (NVD/CVE lookup, $0.01/call, Base). Adjacent but different: smart-contract risk scorers (TOUGH LOVE at $0.25/call, Daizyx at $0.05–$0.50). Off-x402 comparables: DepScope.dev (free, exactly this concept — proves demand, monetization gap), Apify npm/PyPI/OSV scrapers (not x402). **What competitors do badly:** 2s.io buries package data as 2 of 575 undifferentiated endpoints with thin descriptions; nobody offers a consolidated *health/risk score* or *dependency-graph* product tuned for agent consumption. That's the wedge.

### B. Protocol & Technical Specification

**How x402 works end-to-end (v2).**
1. Agent (client) requests your resource: `GET /v1/package/npm/express`.
2. Your server has no payment proof → responds **HTTP 402 Payment Required** with a `PAYMENT-REQUIRED` header + JSON body listing `accepts[]` (scheme, price, network CAIP-2, payTo address, asset).
3. Client signs a stablecoin transfer authorization (USDC via EIP-3009 "transfer with authorization" — gasless for the buyer) and retries the same request with a `PAYMENT-SIGNATURE` header.
4. Your server calls the **facilitator** `/verify` then `/settle`. Facilitator broadcasts settlement on-chain (Base ~2s finality).
5. Server returns 200 with the data + a `PAYMENT-RESPONSE` header (settlement receipt/tx hash).

**Payment schemes:** `exact` (fixed price — use this), `upto` (usage-based max, EVM only), `batch-settlement` (payment channels for high-frequency sessions, EVM only). Start with `exact`.

**Current SDKs / packages (verified live).**
- TypeScript core: `@x402/core` (v2.x), `@x402/evm` (v2.9.0, ~9 days old at time of research), `@x402/svm`, framework middlewares `@x402/express`, `@x402/hono`, `@x402/next`, plus `@x402/extensions` (Bazaar + gas sponsorship), `@x402/mcp`, `@x402/axios`, `@x402/fetch`.
- Facilitator helper: `@coinbase/x402` (exports `facilitator` config + `createFacilitatorConfig`).
- Python: `pip install "x402[fastapi]"` or `"x402[flask]"`, `[svm]` for Solana.
- **Instability flags:** v1 packages (`x402-express`, `x402-next`) are **deprecated** — use the v2 `@x402/*` scoped packages. Don't mix v1 `X-PAYMENT` headers with v2 `PAYMENT-SIGNATURE`. A signature-verification bypass was disclosed in March 2026; replay/front-running/grant-before-settle issues have been documented across SDKs — use audited current versions and the facilitator's verify+settle (don't hand-roll crypto).

**Networks & assets — recommendation: Base mainnet, USDC.** Base handles ~85–90% of x402 volume, ~2s finality, sub-cent gas, and USDC via EIP-3009 is gasless for buyers through the CDP facilitator. CAIP-2 IDs: Base mainnet `eip155:8453`, Base Sepolia (testnet) `eip155:84532`. Optionally add Solana (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`) later as a second `accepts[]` option for the Solana-native agent cohort — but ship Base-only first.

**Discovery layer.** In x402 v2 the Bazaar is an official extension (`@x402/extensions/bazaar`). If you use the CDP facilitator and set the discovery extension with `discoverable: true` plus input/output schemas, the CDP facilitator **auto-catalogs your endpoint the first time it successfully settles a payment** (indexing runs after settle, not verify). No separate registration. It then surfaces via CDP discovery APIs (`GET /v2/x402/discovery/resources`, `/search`, `/mcp`). Additionally maintain a `/.well-known/x402` manifest for other indexers (agentic.market, x402scan, x402-list). Important indexing gotcha: when Bazaar crawls, it sends the input defined in your Bazaar extension; **your server must return 402 to that probe** (not 400) or it won't be indexed — populate `bazaar.info.input` with a valid sample request.

**MCP integration.** Expose the same service as an MCP server so agents in Claude Desktop/Cursor can call it as a tool. Two patterns: (a) an MCP server that *wraps your paid HTTP API* and pays on the caller's behalf using `@x402/axios` + `wrapAxiosWithPayment` (buyer supplies their wallet key); or (b) an MCP server that *is* the paid resource via Streamable HTTP with x402 gating on tool calls. For selling, ship (a) — a thin MCP wrapper that lists your tools (`package_health`, `package_vulns`, etc.) and, on a 402, auto-pays from the agent's configured wallet. This is how agents in Claude Desktop discover and consume your endpoint.

**Facilitators & tradeoffs.**
- **CDP (Coinbase) facilitator — recommended.** URL `https://api.cdp.coinbase.com/platform/v2/x402`. Supports Base/Polygon/Arbitrum/World/Solana; free tier first 1,000 settled payments/month then $0.001 per settled payment; gas sponsorship for buyers; built-in KYT/OFAC screening; auto-Bazaar listing. Requires CDP API keys. Zero fee on Base per Coinbase's positioning; confirm gas config.
- **x402.org/facilitator** — testnet only (Base Sepolia, Solana Devnet), no auth. Use for local/dev testing only.
- **Third-party** (PipRail = no facilitator/settle straight to wallet, AlgoVoi/Satoshi multi-chain, etc.) — more control, more responsibility. Not needed for v1.

### C. The Build Spec

**Recommended vertical (final): "Package & Dependency Intelligence API."** Justification: unserved on x402; plays to your dev-tools/ML-dataset background; upstream data is free + permissively licensed + no PII; naturally consumed by the fast-growing coding-agent cohort; consolidatable into a differentiated "health/risk score" product that no x402 competitor offers.

**API design.** Base URL `https://api.<yourdomain>`. All responses JSON. Prices in USDC on Base.

| Endpoint | Method | Params | Price | What it returns |
|---|---|---|---|---|
| `/v1/package/:ecosystem/:name` | GET | ecosystem ∈ {npm,pypi}; name | $0.005 | Consolidated snapshot: latest version, license, description, repo, weekly/monthly downloads, maintainer count, last-publish date, deprecation flag |
| `/v1/health/:ecosystem/:name` | GET | as above | $0.01 | **Health/risk score 0–100** with sub-scores (maintenance, popularity, security, freshness) + human-readable rationale + suggested alternatives if low |
| `/v1/vulns/:ecosystem/:name` | GET | + optional `?version=` | $0.01 | Known vulns from OSV: IDs, CVSS severity, affected ranges, fixed version, references |
| `/v1/deps/:ecosystem/:name` | GET | + optional `?version=&depth=1` | $0.02 | Direct + transitive dependency graph (from deps.dev), counts, deprecated/vulnerable deps flagged |
| `/v1/downloads/:ecosystem/:name` | GET | `?range=last-month` | $0.002 | Time-series download counts |
| `/v1/batch` | POST | `{queries:[{ecosystem,name}...]}` (≤50) | $0.02 flat | Batched health snapshots for a whole manifest |

Example response (`/v1/health/npm/express`):
```json
{
  "ecosystem": "npm",
  "name": "express",
  "version": "5.1.0",
  "score": 92,
  "subscores": { "maintenance": 95, "popularity": 100, "security": 80, "freshness": 90 },
  "signals": {
    "weekly_downloads": 34210567,
    "last_publish": "2026-05-12",
    "open_vulnerabilities": 0,
    "deprecated": false,
    "license": "MIT",
    "maintainers": 12
  },
  "rationale": "Actively maintained, extremely popular, permissive license, no known vulns in latest.",
  "alternatives": [],
  "source_attribution": ["npm registry", "deps.dev (Google)", "OSV.dev"],
  "cached_at": "2026-07-30T12:00:00Z"
}
```

**Upstream data sources, ToS, cost, limits (critical section).**

| Source | Data | Cost | Rate limit | Reselling/caching allowed? |
|---|---|---|---|---|
| **npm registry** `registry.npmjs.org` + `api.npmjs.org/downloads` | metadata, download counts | Free | No formal published limit; "be polite," IP-blocked only at extreme volume (tens of millions/mo); bulk downloads endpoint ≤128 pkgs, ≤365 days | Public data; caching standard practice. Do NOT resell users' personal info (emails). Metadata/stats are fine. Provide attribution. |
| **deps.dev** (Google) HTTP/gRPC | dependency graph, versions, advisories, licenses | Free | No hard limit stated | **README: "Clients are expressly permitted to cache data served by the API."** Subject to Google API ToS. Best-fit source. |
| **OSV.dev** (Google/OpenSSF) | vulnerabilities | Free, no API key | ~100 req/min (public); `/v1/querybatch` ≤1,000 queries/req | Data is MIT/CC — free to use and redistribute with attribution. |
| **PyPI** (`pypi.org/pypi/<pkg>/json`, pypistats) | metadata, downloads | Free | Be polite; pypistats has its own limits | Public metadata; cache. |

**ToS conflict flag:** Do **not** build the "resell GitHub users' personal info" path — GitHub's ToS explicitly prohibits using the API to sell users' personal information (recruiters/headhunters/etc.). Repo *stars/forks/topics/license* (non-personal) are fine with attribution. This is why the recommended vertical avoids contact/lead data entirely — it sidesteps both PII compliance and ToS reselling conflicts.

**Caching & cost-control (this is what protects your margin).**
- Cache upstream responses in-process (LRU) + a small persistent store (SQLite/Redis). TTLs: package metadata 6–24h; download stats 24h; vulns 1–6h; dependency graph 24h. Coding-agent queries are heavily long-tail-repeating (everyone asks about `express`, `react`, `requests`), so a warm cache serves the vast majority of paid calls with zero upstream cost.
- Pre-warm the top ~5,000 npm + top ~5,000 PyPI packages on a daily cron. This makes the hot path a local read.
- Since upstream is free, the risk isn't $ cost but rate-limiting/bans — caching + a global upstream concurrency limiter (e.g., p-limit) + exponential backoff prevents that.

**Error handling, idempotency, refund semantics.**
- **Payment succeeded but upstream failed:** because `exact` settles on-chain before you can guarantee upstream success, adopt a **serve-cache-or-fail-open** policy: (1) try warm cache first, always; (2) if cache miss and upstream errors, return the last-known cached value with a `stale: true` flag rather than failing; (3) only if you have literally nothing, and you detect upstream is down, **verify-but-do-not-settle** (skip the `/settle` call so the buyer isn't charged for a failure). The x402 flow lets you verify a payment without settling; use that to avoid charging for a failure.
- **Idempotency:** cache keyed by `(ecosystem,name,version,endpoint)`; identical requests within TTL return identical bytes. Payment signatures are single-use (facilitator enforces anti-replay).
- Standard HTTP codes: 400 (bad ecosystem/name — reject *before* settle), 404/not-found (return 200 `{found:false}` and skip settle to avoid charging disputes), 402 (no/invalid payment), 429 (your own abuse limit), 5xx (return stale cache).

**Abuse prevention & spending safeguards.**
- Per-IP and per-payer request rate limits (even though each call is paid, cap burst to protect upstream).
- Input validation/sanitization on package names (prevent SSRF/path injection into upstream URLs — allowlist ecosystems, URL-encode names).
- Helmet headers, CORS, request size caps on `/v1/batch`.
- Cap batch size (≤50). Reject unknown ecosystems fast (before payment settle).

**Reliability (agents that hit failures don't return).**
- Target ≥99% uptime. Health check `GET /healthz` (no payment) returning cache stats + upstream reachability.
- Uptime monitoring (UptimeRobot/BetterStack free tier) hitting `/healthz` every 1–5 min with alert to email/Telegram.
- Structured logging of every call: endpoint, payer, price, cache hit/miss, upstream latency, settle tx hash.
- Graceful degradation (stale cache) over hard failure.

**Deployment recommendation.** For an always-on Node/TS service with a small persistent cache, **Railway Hobby ($5/mo, includes $5 usage credit)** is the best fit: git-push deploy, managed Redis/Postgres one-click, predictable bill (~$5/mo at this scale), great DX. Alternatives: **Fly.io** (from ~$2/mo pay-as-you-go, more ops, good multi-region; note Fly no longer has a standing free tier for new users), **Render** ($7/mo Starter; real free tier exists but web services spin down after 15 min idle — bad for agent availability), **Cloudflare Workers** (free 100k req/day, global edge, but V8-isolate runtime = no Node APIs; viable only if you write to the Workers runtime and use Workers KV for cache — a strong option for a stateless cached read API, and cheapest at scale). **Recommendation: Railway for v1** (fastest path, stateful cache easy). Consider Cloudflare Workers + KV for v2 if call volume grows and you want edge latency + near-zero cost.

**Wallet setup (crypto newcomer, step by step).**
1. **Create a dedicated receiving wallet** for this project only (never your personal wallet). Options: (a) a self-custody EVM wallet (MetaMask/Rabby) — generate a new account; (b) or a **CDP-managed wallet** (no raw private key in your env — recommended for a newcomer; CDP holds keys, you authenticate with API keys).
2. **Secure the seed phrase / key** offline (paper + password manager). For the *receiving* side you only need the public address (`payTo`), which is safe to expose in 402 responses — you do NOT need a private key on the server to receive. A private key is only needed on the *buyer* side (your MCP wrapper) or if you run your own facilitator.
3. **Key hygiene:** `.env` in `.gitignore`; never commit keys; use the host's secret store (Railway variables).
4. **CDP account:** sign up at cdp.coinbase.com, create a project, generate `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` for the mainnet facilitator.
5. **Receiving & off-ramping USDC:** payments arrive as USDC on Base to your address. To convert to CAD: send USDC to a Canadian exchange that supports Base USDC (e.g., a Coinbase account), sell to CAD, withdraw to bank. Keep records of every settlement (date, USDC amount, CAD FMV at receipt) — see tax section.
6. **Test on Base Sepolia first** (CDP faucet for test ETH/USDC), then flip network to `eip155:8453` and use small real amounts before launch.

**Observability (track calls, revenue, which endpoints earn).**
- Log each settled call to a table: timestamp, endpoint, ecosystem, package, price, payer, tx_hash, cache_hit.
- A `/stats` admin route (auth-gated) or a tiny dashboard: total revenue, revenue by endpoint, calls/day, cache hit rate, top packages queried, unique payers.
- Cross-check on-chain via BaseScan (your payTo address) and x402scan (your seller page) — both are independent sources of truth for revenue.

**Recommended stack & code (Node.js/TypeScript + Hono).**

*Why TS + Hono:* the x402 TS SDK is the most mature and fastest-moving (v2 `@x402/*`), Hono runs on Node and Cloudflare Workers (easy v2 migration), and the MCP TS SDK is first-class. Python is viable (`x402[fastapi]`) but the TS ecosystem has more x402 examples and the Bazaar/MCP tooling is TS-first.

Install:
```bash
npm install @x402/hono @x402/evm @x402/core @x402/extensions @coinbase/x402 hono @hono/node-server lru-cache
npm install @modelcontextprotocol/sdk @x402/axios axios viem   # for the MCP wrapper
```

Server (mainnet, with Bazaar discovery):
```typescript
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { facilitator } from "@coinbase/x402"; // reads CDP_API_KEY_ID / CDP_API_KEY_SECRET
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { getHealth, getVulns, getDeps, getSnapshot, getDownloads } from "./data.js";

const app = new Hono();
const payTo = process.env.PAY_TO as `0x${string}`;
const NET = "eip155:8453"; // Base mainnet

const facilitatorClient = new HTTPFacilitatorClient(facilitator);
const server = new x402ResourceServer(facilitatorClient).register(NET, new ExactEvmScheme());

app.get("/healthz", (c) => c.json({ ok: true }));

app.use(
  paymentMiddleware(
    {
      "GET /v1/health/:ecosystem/:name": {
        accepts: [{ scheme: "exact", price: "$0.01", network: NET, payTo }],
        description: "Package health & risk score (0-100) with sub-scores and alternatives for npm/PyPI packages.",
        mimeType: "application/json",
        extensions: {
          ...declareDiscoveryExtension({
            category: "developer-tools",
            tags: ["npm", "pypi", "dependencies", "security", "package-health"],
            info: { input: { /* sample valid request so Bazaar probe gets a 402 */ } },
          }),
        },
      },
      "GET /v1/vulns/:ecosystem/:name": {
        accepts: [{ scheme: "exact", price: "$0.01", network: NET, payTo }],
        description: "Known vulnerabilities (OSV) for a package/version.",
        mimeType: "application/json",
      },
      "GET /v1/deps/:ecosystem/:name": {
        accepts: [{ scheme: "exact", price: "$0.02", network: NET, payTo }],
        description: "Dependency graph (deps.dev) with vulnerable/deprecated flags.",
        mimeType: "application/json",
      },
      "GET /v1/package/:ecosystem/:name": {
        accepts: [{ scheme: "exact", price: "$0.005", network: NET, payTo }],
        description: "Consolidated package snapshot.",
        mimeType: "application/json",
      },
      "GET /v1/downloads/:ecosystem/:name": {
        accepts: [{ scheme: "exact", price: "$0.002", network: NET, payTo }],
        description: "Download time-series.",
        mimeType: "application/json",
      },
    },
    server,
  ),
);

app.get("/v1/health/:ecosystem/:name", async (c) =>
  c.json(await getHealth(c.req.param("ecosystem"), c.req.param("name"))));
// ...wire the other handlers similarly...

serve({ fetch: app.fetch, port: Number(process.env.PORT) || 4021 });
```

Data layer sketch (`data.ts`) with caching + fail-open:
```typescript
import { LRUCache } from "lru-cache";
const cache = new LRUCache<string, any>({ max: 20000, ttl: 1000 * 60 * 60 * 6 });

async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const val = await fn();
    cache.set(key, val, { ttl });
    return val;
  } catch (e) {
    if (hit) return { ...hit, stale: true };  // serve stale on failure
    throw e;
  }
}

export async function getVulns(eco: string, name: string, version?: string) {
  const ecosystem = eco === "npm" ? "npm" : "PyPI";
  return cached(`vuln:${eco}:${name}:${version ?? ""}`, 1000 * 60 * 60, async () => {
    const r = await fetch("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: { name, ecosystem }, ...(version ? { version } : {}) }),
    });
    const j = await r.json();
    return { ecosystem: eco, name, version, vulns: j.vulns ?? [], source_attribution: ["OSV.dev"] };
  });
}
// getSnapshot -> registry.npmjs.org / pypi.org json; getDownloads -> api.npmjs.org/downloads; getDeps -> api.deps.dev
```

MCP wrapper (so Claude Desktop/Cursor agents can call & auto-pay):
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios from "axios";
import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`);
const client = new x402Client();
registerExactEvmScheme(client, account);
const http = wrapAxiosWithPayment(axios.create({ baseURL: process.env.API_URL }), client);

const mcp = new McpServer({ name: "package-intel", version: "1.0.0" });
mcp.tool("package_health", "Get health/risk score for an npm or PyPI package",
  { ecosystem: { type: "string" }, name: { type: "string" } },
  async ({ ecosystem, name }) => {
    const { data } = await http.get(`/v1/health/${ecosystem}/${name}`); // auto-handles 402→pay→retry
    return { content: [{ type: "text", text: JSON.stringify(data) }] };
  });
await mcp.connect(new StdioServerTransport());
```

Also add a static, unpaid `/.well-known/x402` manifest route mirroring your endpoints + prices for third-party indexers, and a free `/v1/sample` route returning a canned response for evaluation.

### D. Pricing & Go-to-Market

**Evidence-based pricing.** ~76% of x402 services price ≤$0.10; ~69% in $0.01–$0.10; median $0.005–$0.028. Your data is cheap-to-produce (free upstream, cached), so price low to win agent selection (agents optimize on cost): **$0.002 downloads, $0.005 snapshot, $0.01 health/vulns, $0.02 deps/batch.** This sits at/below median, undercuts the $0.01 CVE competitor for richer data, and still carries ~100% margin on cache hits. Revisit upward only if you become a default tool.

**Where to list (and effort-worth ranking).**
1. **CDP Bazaar — automatic, highest value.** Use CDP facilitator + discovery extension; you're indexed on first settled payment. Zero extra effort. Do this.
2. **`/.well-known/x402` manifest** — enables agentic.market, x402scan, x402-list, and misc indexers to pick you up. Low effort, do it.
3. **x402-list.com** — submit via their form (auto-probed for valid 402, then human review). Worth it.
4. **MCP registries — worth it for the coding-agent audience:** publish `server.json` to the official **MCP Registry** (reverse-DNS namespace, prove ownership via GitHub); then claim/submit on **Glama** (auto-indexes open-source GitHub MCP servers; ~64k listed), **Smithery** (`smithery mcp publish <url> -n yourorg/your-server`), **PulseMCP**. These reach Claude Desktop/Cursor users directly.
5. **`awesome-x402` (xpaysh) + `awesome-agentic-commerce` (Merit) GitHub lists** — open a PR. Free, decent discovery, and where other builders look.
6. **x402scan seller page** — automatic once you transact through a tracked facilitator.

**Launch/promotion tactics that work here.**
- Ship the MCP wrapper + a one-line Claude Desktop/Cursor config in your README — coding agents are the buyers; make it trivial to add.
- Publish a short "here's a payable package-intelligence tool for your coding agent" post on the x402 Discord, r/mcp, and dev.to (the ecosystem actively shares new endpoints).
- Provide a **free sample** endpoint (`/v1/sample`) so agents/humans can evaluate before paying — common pattern (Crypto Data Agent, HSH do this).
- Seed a few real transactions yourself so you appear in Bazaar/x402scan (indexing requires a settled payment).

### E. Risks & Honest Caveats

**Regulatory/tax (Canada/Ontario) — general information, not advice; consult a Canadian crypto-savvy CPA.** The CRA treats crypto as a commodity, not currency. USDC received for services is **business income at CAD fair-market-value on the date of receipt** — record every settlement's date, USDC amount, and CAD FMV. As a sole proprietor this flows into business income (taxed at your marginal rate; Ontario's top combined marginal rate is 53.53% on income above $235,675 per EY's 2026 table, combining the 33% federal top rate with Ontario's surtax-inflated ~20.53% provincial rate — most founders will be well below this). **GST/HST:** once taxable supplies exceed **CAD $30,000 over four quarters**, you must register and remit GST/HST — but services sold to non-residents/agents may be zero-rated; get advice. Later disposition of the USDC (converting to CAD) can trigger a small additional capital gain/loss vs. the FMV cost basis at receipt. Keep records ≥6 years. Canada is implementing OECD CARF crypto reporting from 2026. **Talk to a professional before you scale.**

**Protocol & ecosystem risks.**
- **Facilitator centralization:** Coinbase's facilitator verifies most transactions; its downtime could darken your endpoint. Mitigate later with local verification fallback or a second facilitator.
- **Security:** documented replay/front-running/verification-bypass issues in x402 SDKs (a signature-bypass was disclosed March 2026). Pin current audited versions; rely on facilitator verify+settle; never hand-roll signature checks.
- **Marketplace concentration:** ~85–90% of volume is Base; if Base/CDP economics change, so does your channel.
- **Race to the bottom:** micro-priced data commoditizes; defend with a differentiated *scored/consolidated* product and MCP-native UX, not raw passthrough.
- **Upstream risk:** deps.dev/OSV/npm could change ToS, add auth, or rate-limit. Mitigate with caching, multiple sources per signal, and attribution. (Current ToS are favorable — deps.dev explicitly allows caching; OSV is MIT; npm is public.)
- **Demand risk:** the whole category may stay small for a long time. ~Half of listed endpoints are already dead; agent commerce is early and workload-driven (a single campaign can swing daily volume 30–50%).

**Is it worth it?** As income, no — expected year-one earnings are single-to-low-double-digit dollars/month for most, and even success looks like a few hundred/month. As a **cheap, high-optionality learning project** that (a) plants a flag in an uncontested niche, (b) teaches you the entire agentic-payments + MCP stack, and (c) becomes the reusable template for your intended portfolio-of-endpoints, **yes** — the downside is ~$5–10/month and a weekend, the upside is asymmetric if agent commerce compounds. Build it lean, automate listing, and don't over-invest until you see real, repeat, non-self paid traffic.

---

## Recommendations

**Staged plan with go/no-go thresholds.**

**Day 1 (setup + testnet):**
- Create dedicated wallet (or CDP-managed wallet); set up CDP account + API keys; secure keys in a password manager; `.env` in `.gitignore`.
- Scaffold Hono + `@x402/hono` server; implement `/v1/health` and `/v1/vulns` against OSV + npm registry with LRU caching; run on **Base Sepolia** via `x402.org/facilitator`; test the full 402→pay→retry loop with a test buyer.
- Milestone: a testnet call returns paid data end-to-end.

**Week 1 (mainnet + full API + discovery):**
- Implement all endpoints + `/healthz` + `/v1/sample` + `/.well-known/x402` + caching TTLs + fail-open/skip-settle-on-failure.
- Switch to CDP facilitator + `eip155:8453`; enable Bazaar discovery extension; deploy to Railway Hobby; add UptimeRobot on `/healthz`.
- Build + publish the MCP wrapper; write the README with Claude Desktop/Cursor config.
- Seed 2–3 real settled payments to trigger Bazaar/x402scan indexing.
- Milestone: live on mainnet, indexed in Bazaar, MCP installable.

**Month 1 (distribution + measure):**
- List everywhere: MCP Registry + Glama + Smithery + PulseMCP; x402-list; awesome-x402 & awesome-agentic-commerce PRs; Discord/dev.to launch post.
- Pre-warm top 5k npm + 5k PyPI packages via daily cron; stand up `/stats` dashboard; reconcile revenue against BaseScan + x402scan.
- **Go/no-go thresholds:** if after 30 days you see **≥50 distinct non-self payers or ≥5,000 paid calls/month**, invest in a second endpoint and Solana support. If **<500 paid calls and <10 payers**, keep it running (near-zero cost) as a flag/learning asset but stop active investment and reassess in 3 months. If upstream bans or ToS shift, pivot sources; if a facilitator outage recurs, add local verification fallback.

**Portfolio path:** once this template works, clone it for the next uncontested dev-tools niche (e.g., API/OpenAPI spec intelligence, container-image/SBOM risk, license-compliance checks) — reuse the same middleware, caching, MCP wrapper, and listing automation.

## Caveats

- **Early, thin, and volatile ecosystem.** All earnings figures are estimates; the honest denominator is ~$1.11M genuine monthly ecosystem volume spread across a long tail where the top service (StableEnrich) made ~$3,120/month across 108,000 transactions and the long tail makes cents. Headline cumulative numbers (165M–194M tx, ~$50M) include tests/self-dealing; CoinDesk pegged genuine daily volume at ~$28,000 in March 2026, and PulseFeed found ~half of listed endpoints are dead.
- **SDK churn & security.** `@x402/*` v2 packages update frequently (evm 2.9.0 was ~9 days old at research time); v1 packages (`x402-express`, `x402-next`) are deprecated; a signature-verification bypass was disclosed March 2026. Pin and update deliberately; rely on facilitator verify+settle.
- **Competitive scan limits.** The "unserved niche" conclusion is based on searching x402scan, awesome-x402, x402-list, Bazaar/agentic.market, and Glama/Smithery in mid-2026; directories are incomplete and ~half of listings are dead, so a stealth competitor may exist. The gap is nonetheless well-evidenced (no dev-tooling category exists in any directory's taxonomy; only incidental coverage via 2s.io's 2 registry endpoints and cve.hugen.tokyo).
- **Tax/legal is general information only.** CRA rules on crypto business income and GST/HST are summarized, not advice — consult a Canadian CPA before scaling, especially near the CAD $30k GST/HST registration threshold and for CARF reporting.
- **Not investment or income advice.** This is a low-cost, high-optionality experiment; size your effort accordingly.