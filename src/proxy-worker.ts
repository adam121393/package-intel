import type { Hono } from "hono";
import { createFreeApp, isFreeRoute } from "./freeApp.js";

/**
 * Edge front door: serves the free tier itself, proxies the paid tier.
 *
 * The paid routes need Base mainnet, which does not work on the Workers runtime,
 * so they still go to a Node host behind a Cloudflare Tunnel. Payment headers
 * (PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE) pass through
 * untouched, so the mainnet incompatibility never applies here.
 *
 * The free routes have no such constraint — they are fetch-and-cache over public
 * APIs — so they are answered at the edge and no longer depend on the origin PC
 * being awake. That machine's tunnel died three times in two days while
 * cloudflared still reported healthy connections, and the free tools are what
 * every new install touches, so this is the difference between "occasionally
 * down" and "up".
 *
 * Update the proxy target with:  npm run set-origin -- https://<new>.trycloudflare.com
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

// Built once per isolate and reused, so the LRU cache behind the sources stays
// warm across requests instead of being discarded each time.
let freeApp: Hono | undefined;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Free tier, served here. Never touches the origin, so it stays up when the
    // origin PC does not.
    if (isFreeRoute(url.pathname)) {
      freeApp ??= createFreeApp({
        // Set by the runtime and not forgeable by the caller, so unlike the
        // origin this needs no shared secret to be trustworthy.
        clientKey: (req) => req.headers.get("cf-connecting-ip") ?? "unknown",
      });
      const response = await freeApp.fetch(request);
      const headers = new Headers(response.headers);
      headers.set("X-Served-By", "edge");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    const origin = env.ORIGIN;
    if (!origin) {
      return Response.json(
        { error: "Proxy misconfigured: ORIGIN is not set." },
        { status: 500 },
      );
    }

    // Health is answered at the edge and reports each tier separately. Proxied,
    // it would return 503 whenever the origin slept, which reads as a total
    // outage — but the free tier, which is what installs actually use, is still
    // up. Monitoring should be able to tell those two apart.
    if (url.pathname === "/healthz") {
      const paidUp = await fetch(new URL("/healthz", origin).toString(), {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      })
        .then((r) => r.ok)
        .catch(() => false);

      return Response.json(
        {
          ok: true,
          free: { ok: true, servedBy: "edge" },
          paid: {
            ok: paidUp,
            servedBy: "origin",
            ...(paidUp ? {} : { detail: "Origin unreachable; paid endpoints are unavailable." }),
          },
        },
        { status: 200, headers: { "X-Served-By": "edge" } },
      );
    }

    const target = new URL(url.pathname + url.search, origin);

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
    headers.set("x-stable-host", url.host);
    headers.set("x-stable-proto", url.protocol.replace(":", ""));

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
