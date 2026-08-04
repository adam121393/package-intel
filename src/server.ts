import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { getConfig } from "./config.js";

/** Node entrypoint. The Cloudflare Workers entrypoint is src/worker.ts. */

const config = getConfig();
const app = createApp();

/**
 * When running behind a reverse proxy (the Workers proxy in front of a
 * Cloudflare Tunnel), rebuild the request URL from the forwarded host/proto.
 *
 * x402 derives the resource URL of a payment requirement from the incoming
 * request. Left alone, that would be the tunnel's random hostname over plain
 * http, so every advertised resource URL would be both wrong and short-lived.
 */
const fetchWithForwardedHost: typeof app.fetch = (request, ...rest) => {
  // x-stable-host is set by our own Workers proxy. A custom name is used because
  // cloudflared rewrites x-forwarded-host to the tunnel's own hostname, which
  // would defeat the point; x-forwarded-host is kept as a fallback for other
  // proxies.
  const host =
    request.headers.get("x-stable-host") ?? request.headers.get("x-forwarded-host");
  if (host) {
    const url = new URL(request.url);
    url.host = host;
    url.port = ""; // otherwise the local listen port leaks into public URLs
    url.protocol = `${request.headers.get("x-stable-proto") ?? request.headers.get("x-forwarded-proto") ?? "https"}:`;
    request = new Request(url, request);
  }
  return app.fetch(request, ...rest);
};

serve({ fetch: fetchWithForwardedHost, port: config.port }, (info) => {
  console.log(`package-intel-x402 listening on http://localhost:${info.port}`);
  console.log(
    `network=${config.network} (${config.isMainnet ? "MAINNET — real funds" : "testnet"}) ` +
      `facilitator=${config.useCdpFacilitator ? "CDP" : config.facilitatorUrl}`,
  );
  console.log(`payTo=${config.payTo} publicUrl=${config.publicUrl}`);
});
