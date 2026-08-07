/**
 * Stable-URL reverse proxy.
 *
 * The x402 service itself runs on a Node host (a PC behind a Cloudflare Tunnel),
 * because Base mainnet does not work on the Workers runtime. Quick tunnels get a
 * new random hostname on every restart, which is useless for discovery listings —
 * so this Worker sits at a fixed workers.dev address and forwards everything to
 * whatever the current tunnel hostname is.
 *
 * It deliberately does no x402 logic: it is a transparent pass-through, so the
 * payment headers (PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE)
 * flow through untouched and the Workers mainnet incompatibility never applies.
 *
 * Update the target with:  npm run set-origin -- https://<new>.trycloudflare.com
 */

interface Env {
  ORIGIN?: string;
  /**
   * Shared with the origin. Proves the forwarded client address came from this
   * Worker; without it the origin cannot distinguish our header from one the
   * caller invented, and the free-tier rate limit is bypassable.
   * Set with: npx wrangler secret put PROXY_SECRET
   */
  PROXY_SECRET?: string;
}

/** Hop-by-hop and Cloudflare-injected headers that must not be forwarded upstream. */
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "x-forwarded-proto",
  "x-real-ip",
  // Client-supplied values for headers we set ourselves below, dropped so a
  // caller cannot pre-seed them and impersonate the proxy.
  "x-stable-host",
  "x-stable-proto",
  "x-stable-ip",
  "x-proxy-secret",
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ORIGIN;
    if (!origin) {
      return Response.json(
        { error: "Proxy misconfigured: ORIGIN is not set." },
        { status: 500 },
      );
    }

    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, origin);

    const headers = new Headers();
    for (const [key, value] of request.headers) {
      if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
    }

    // Tell the origin which public hostname the client actually used. Without
    // this it would build payment-requirement resource URLs from the tunnel
    // hostname, which changes on every restart — so anything catalogued from
    // those URLs (Bazaar, indexers) would break as soon as the tunnel cycled.
    // A custom header name: cloudflared overwrites x-forwarded-host with the
    // tunnel's own hostname, so the standard header cannot survive the hop.
    headers.set("x-stable-host", incoming.host);
    headers.set("x-stable-proto", incoming.protocol.replace(":", ""));

    // The origin meters its free tier per caller, but sits behind this proxy and
    // a tunnel, so every request reaches it from the same address. Forward the
    // real one, signed with the shared secret — the origin ignores an unsigned
    // address and buckets those requests together, since the tunnel hostname is
    // directly reachable and anyone could otherwise forge a fresh address per
    // request to get unlimited free upstream calls.
    const clientIp = request.headers.get("cf-connecting-ip");
    if (clientIp && env.PROXY_SECRET) {
      headers.set("x-stable-ip", clientIp);
      headers.set("x-proxy-secret", env.PROXY_SECRET);
    }

    try {
      const upstream = await fetch(target.toString(), {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
      });

      // Pass the response through unchanged so payment headers survive intact.
      const outHeaders = new Headers(upstream.headers);
      outHeaders.delete("transfer-encoding");
      outHeaders.delete("connection");

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: outHeaders,
      });
    } catch (err) {
      // Most likely the host PC is off/asleep or the tunnel has been restarted
      // with a new hostname. Say so plainly rather than surfacing a raw error.
      return Response.json(
        {
          error: "Upstream service unavailable",
          detail:
            "The origin behind this endpoint is not reachable. It may be offline, or its tunnel hostname may have changed.",
          message: err instanceof Error ? err.message : String(err),
        },
        { status: 503 },
      );
    }
  },
};
