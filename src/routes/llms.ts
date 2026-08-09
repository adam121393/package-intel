import { CATALOG, isPaid } from "../catalog.js";
import { ECOSYSTEMS } from "../sources/registry.js";

/**
 * /llms.txt — the plain-text convention agents use to work out what an API
 * offers before calling it.
 *
 * Built from the catalog so prices and tiers cannot drift from what the payment
 * middleware actually charges, and served at the edge rather than the origin:
 * a discovery document that disappears when a laptop sleeps is worse than none,
 * because indexers cache the failure.
 */
export function renderLlmsTxt(baseUrl: string): string {
  const free = CATALOG.filter((e) => !isPaid(e));
  const paid = CATALOG.filter(isPaid);

  const line = (route: string, description: string, price: string) => {
    const [method, path] = route.split(" ");
    return `- ${method} ${baseUrl}${path} — ${price}\n  ${description}`;
  };

  return `# Package & Dependency Intelligence

> Software supply-chain data for AI coding agents: is this package maintained,
> popular, vulnerable, or deprecated? Covers ${ECOSYSTEMS.join(", ")}.

Data comes from the npm registry, PyPI, crates.io, OSV.dev (Google/OpenSSF) and
deps.dev (Google Open Source Insights), consolidated so an agent makes one call
instead of four. No account, no API key, no signup.

## Free endpoints

No payment required. Rate limited to 60/minute and 2000/day per caller.

${free.map((e) => line(e.route, e.description, "free")).join("\n")}

## Paid endpoints

Priced per call in USDC on Base mainnet (eip155:8453) via x402 v2. An unpaid
request returns 402 with the exact amount and address.

${paid.map((e) => line(e.route, e.description, e.price)).join("\n")}

## Paying

Two methods, both accepted on every paid route:

1. x402 (preferred) — send a PAYMENT-SIGNATURE header. Gasless for the buyer,
   settled by the Coinbase CDP facilitator, no confirmation wait.
2. tx_hash — send the price in USDC yourself, then retry with ?tx_hash=<hash>
   (or "tx_hash" in a JSON body). For agents that cannot sign x402 headers.
   Each hash is accepted once, within 15 minutes of confirming. Note that a
   transaction hash is public once confirmed and the first caller to present it
   consumes it, so prefer x402.

A request that fails is never charged: payment is settled only for a response
that actually returned data.

## MCP

An MCP server exposes these as tools for Claude Desktop, Claude Code and Cursor:

    claude mcp add package-intel -- npx -y package-intel-mcp

Free tools work with no wallet and no configuration. Setting X402_PRIVATE_KEY
additionally unlocks the paid tools.

## Discovery

- Manifest: ${baseUrl}/.well-known/x402
- Health:   ${baseUrl}/healthz
- Source:   https://github.com/adam121393/package-intel
- npm:      https://www.npmjs.com/package/package-intel-mcp

## Attribution

Vulnerability data from OSV.dev; dependency graphs from deps.dev; package
metadata and download counts from the npm registry, PyPI and crates.io. This
service consolidates and scores that data; it does not originate it.
`;
}
