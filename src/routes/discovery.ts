import type { Hono } from "hono";
import { CATALOG, type CatalogEntry, isPaid, SERVICE_TAGS } from "../catalog.js";
import { getConfig } from "../config.js";

/**
 * Builds a concrete, probeable URL for a catalog entry.
 *
 * Indexers auto-probe the advertised `resource` URL, and for paid entries only
 * list the ones that answer 402. Advertising the raw template
 * (".../:ecosystem/:name") makes the probe hit our ecosystem validation and get
 * a 400 instead, which silently prevents listing — so real sample values are
 * substituted here, same reason the Bazaar declaration uses real path params.
 * Free entries are probed the same way and answer 200.
 */
function sampleUrl(entry: CatalogEntry): string {
  const config = getConfig();
  const [, path] = entry.route.split(" ") as [string, string];
  const concrete = Object.entries(entry.pathParams ?? {}).reduce(
    (acc, [key, value]) => acc.replace(`:${key}`, encodeURIComponent(value)),
    path,
  );
  const query = entry.queryParams
    ? `?${new URLSearchParams(
        Object.entries(entry.queryParams).map(([k, v]): [string, string] => [k, String(v)]),
      )}`
    : "";
  return `${config.publicUrl}${concrete}${query}`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] ?? ch,
  );
}

interface EndpointRow {
  method: string;
  path: string;
  price: string;
  description: string;
}

/** Splits the catalog into the two tiers the index and manifest advertise. */
function endpointRows(): { free: EndpointRow[]; paid: EndpointRow[] } {
  const rows = CATALOG.map((entry) => {
    const [method, path] = entry.route.split(" ") as [string, string];
    return {
      method,
      path,
      price: isPaid(entry) ? entry.price : "free",
      description: entry.description,
      tier: entry.tier,
    };
  });
  return {
    free: rows.filter((r) => r.tier === "free"),
    paid: rows.filter((r) => r.tier === "paid"),
  };
}

function table(rows: EndpointRow[]): string {
  const body = rows
    .map(
      (e) => `<tr>
      <td><code>${e.method}</code></td>
      <td><code>${escapeHtml(e.path)}</code></td>
      <td class="price">${escapeHtml(e.price)}</td>
      <td>${escapeHtml(e.description)}</td>
    </tr>`,
    )
    .join("\n");

  return `<table>
    <thead><tr><th>Method</th><th>Path</th><th>Price</th><th>Description</th></tr></thead>
    <tbody>
${body}
    </tbody>
  </table>`;
}

function indexHtml(free: EndpointRow[], paid: EndpointRow[]): string {
  const config = getConfig();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(config.serviceName)}</title>
<style>
  :root { color-scheme: light dark; --fg: #111; --muted: #666; --bg: #fff; --line: #e2e2e2; --accent: #0a7; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e8e8e8; --muted: #999; --bg: #141414; --line: #2c2c2c; --accent: #3c9; }
  }
  body { margin: 0 auto; padding: 2.5rem 1.25rem; max-width: 60rem; background: var(--bg); color: var(--fg);
         font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1 { margin: 0 0 .25rem; font-size: 1.6rem; }
  p.sub { margin: 0 0 2rem; color: var(--muted); }
  h2 { font-size: 1.05rem; margin: 2rem 0 .75rem; }
  table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
  th, td { text-align: left; padding: .55rem .7rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .875em; }
  .price { white-space: nowrap; color: var(--accent); font-variant-numeric: tabular-nums; }
  ul { padding-left: 1.1rem; }
  .meta { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .875rem; }
  .meta code { word-break: break-all; }
  a { color: var(--accent); }
</style>
</head>
<body>
  <h1>${escapeHtml(config.serviceName)}</h1>
  <p class="sub">Package &amp; dependency intelligence for AI coding agents. Raw package data is
  free; the consolidated score is paid per call over x402.</p>

  <h2>Free endpoints</h2>
  <p class="sub">No payment, no key. Rate limited per caller; see the response headers on a
  <code>429</code>.</p>
  ${table(free)}
  <ul>
    <li><a href="/v1/sample"><code>/v1/sample</code></a> — example response, no payment</li>
    <li><a href="/.well-known/x402"><code>/.well-known/x402</code></a> — machine-readable manifest</li>
    <li><a href="/healthz"><code>/healthz</code></a> — health check</li>
  </ul>

  <h2>Paid endpoints</h2>
  <p class="sub">Requests without payment return <code>402</code> with instructions. Not-found and
  upstream failures return 4xx/5xx and are never charged.</p>
  ${table(paid)}

  <div class="meta">
    Network <code>${escapeHtml(config.network)}</code>${config.isMainnet ? "" : " (testnet)"} ·
    Paid to <code>${escapeHtml(config.payTo)}</code>
  </div>
</body>
</html>`;
}

/**
 * Free, unpaid routes that let agents and humans evaluate the service before
 * paying, and let third-party indexers (agentic.market, x402scan, x402-list)
 * discover it. The CDP Bazaar catalogs via the payment flow instead — see the
 * discovery extensions on the paid routes.
 */
export function registerDiscoveryRoutes(app: Hono) {
  const config = getConfig();

  // Index. Browsers get a readable page; API clients get JSON. Without this,
  // hitting the bare origin 404s, which reads as "the server is broken".
  app.get("/", (c) => {
    const { free, paid } = endpointRows();

    if (!c.req.header("accept")?.includes("text/html")) {
      return c.json({
        name: config.serviceName,
        network: config.network,
        payTo: config.payTo,
        free: [
          ...free.map(({ method, path, description }) => ({ method, path, description })),
          { method: "GET", path: "/healthz", description: "Health check." },
          { method: "GET", path: "/v1/sample", description: "Canned example response." },
          { method: "GET", path: "/.well-known/x402", description: "Machine-readable manifest." },
        ],
        paid,
      });
    }

    return c.html(indexHtml(free, paid));
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  // Canned response so callers can see the shape of the paid data for free.
  app.get("/v1/sample", (c) => {
    const health = CATALOG.find((e) => e.route.includes("/v1/health"));
    return c.json({
      note: "Static sample of the paid health score. Raw package data (snapshot, vulns, deps, downloads) is free and needs no payment — see /.well-known/x402.",
      example: health?.outputExample,
    });
  });

  app.get("/.well-known/x402", (c) =>
    c.json({
      x402Version: 2,
      name: config.serviceName,
      description:
        "Package & dependency intelligence for AI coding agents: health/risk scores, dependency graphs, and vulnerability lookups for npm, PyPI and crates.io (Rust) packages.",
      tags: SERVICE_TAGS,
      // Advertised here as well as in the 402 headers, because an agent that
      // cannot speak x402 needs to learn the alternative exists *before* it
      // gives up on a 402 it does not know how to satisfy.
      ...(config.txPaymentEnabled
        ? {
            paymentMethods: [
              {
                method: "x402",
                preferred: true,
                description:
                  "PAYMENT-SIGNATURE header, settled by the facilitator. Gasless for the buyer, no confirmation wait.",
              },
              {
                method: "tx_hash",
                preferred: false,
                description:
                  "Send the endpoint's price in USDC yourself, then retry the request with ?tx_hash=<hash> (or \"tx_hash\" in a JSON body). Each hash is accepted once.",
                asset: config.usdcAddress,
                payTo: config.payTo,
                network: config.network,
                mustBeUsedWithinSeconds: config.txMaxAgeSeconds,
                warning:
                  "A transaction hash is public once confirmed and the first caller to present it consumes it. Prefer x402.",
              },
            ],
          }
        : {}),
      resources: CATALOG.map((entry) => {
        const [method, path] = entry.route.split(" ") as [string, string];
        return {
          method,
          // Concrete URL an indexer can probe and get a 402 from.
          resource: sampleUrl(entry),
          // Template form, for clients that want to construct their own calls.
          routeTemplate: path,
          description: entry.description,
          mimeType: "application/json",
          ...(entry.body ? { sampleBody: entry.body } : {}),
          // Free resources carry no `accepts` block at all: an empty or
          // zero-priced one would read to an indexer as a malformed payment
          // requirement rather than as "no payment needed".
          ...(isPaid(entry)
            ? {
                price: entry.price,
                accepts: [
                  {
                    scheme: "exact",
                    network: config.network,
                    price: entry.price,
                    payTo: config.payTo,
                    asset: "USDC",
                  },
                ],
              }
            : { price: "free" }),
        };
      }),
    }),
  );
}
