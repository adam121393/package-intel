import { Hono } from "hono";
import { RateLimiter } from "./rateLimit.js";
import { registerDepsRoute } from "./routes/deps.js";
import { registerDownloadsRoute } from "./routes/downloads.js";
import { ecosystemList, parseEcosystem } from "./routes/helpers.js";
import { registerPackageRoute } from "./routes/package.js";
import { registerVulnsRoute } from "./routes/vulns.js";

/**
 * The free tier, with no payment machinery attached.
 *
 * These four routes are pure fetch-and-cache over npm, PyPI, crates.io, OSV and
 * deps.dev. They need no facilitator, no EIP-3009 signing and no Ajv-compiled
 * Bazaar schemas — the three things that make the full app unable to run on
 * Cloudflare Workers. Split out, they can run at the edge, always on, while only
 * the two paid routes still require the Node origin.
 *
 * This is the whole availability argument: the free tools are what every new
 * install touches, and they should not depend on one machine being awake.
 *
 * Deliberately excluded: the discovery routes and manifest, which need payment
 * config (payTo, network) that belongs with the paid origin.
 */

/** Path segments this app owns. Anything else must be proxied to the origin. */
export const FREE_SEGMENTS = new Set(["package", "vulns", "deps", "downloads"]);

export function isFreeRoute(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  return segments[0] === "v1" && FREE_SEGMENTS.has(segments[1] ?? "");
}

export interface FreeAppOptions {
  /**
   * Resolves the rate-limit bucket for a request. On Workers this is
   * `cf-connecting-ip`, which the runtime sets and a caller cannot forge — so
   * unlike the Node origin, no shared proxy secret is needed here.
   */
  clientKey?: (req: Request) => string;
}

export function createFreeApp(options: FreeAppOptions = {}): Hono {
  const app = new Hono();

  // Reject unknown ecosystems before doing any upstream work, and with the same
  // message the origin gives, so a caller cannot tell which one served them.
  app.use("/v1/*", async (c, next) => {
    const segments = c.req.path.split("/").filter(Boolean);
    if (segments.length >= 3) {
      const ecosystem = segments[2] ?? "";
      if (!parseEcosystem(ecosystem)) {
        return c.json(
          { error: `Unsupported ecosystem '${ecosystem}'. Must be ${ecosystemList()}.` },
          400,
        );
      }
    }
    await next();
  });

  // Metering still matters at the edge: the point is protecting npm/OSV/deps.dev
  // from a runaway agent loop, not enforcing a quota. Counters are per-isolate
  // and Workers spawns many, so this is weaker than the origin's — deliberately
  // accepted, since the alternative (a Durable Object or KV round-trip on every
  // request) would cost latency on the hot path for a defence-in-depth measure.
  const limiter = new RateLimiter();
  const clientKey = options.clientKey ?? (() => "shared");

  app.use("/v1/*", async (c, next) => {
    const verdict = limiter.check(clientKey(c.req.raw));
    if (verdict.allowed) return next();
    return c.json(
      {
        error: `Free tier rate limit exceeded (per-${verdict.window} cap).`,
        retryAfterSeconds: verdict.retryAfterSeconds,
        hint: "Paid endpoints are not rate limited — see /.well-known/x402.",
      },
      429,
      { "Retry-After": String(verdict.retryAfterSeconds) },
    );
  });

  registerPackageRoute(app);
  registerVulnsRoute(app);
  registerDepsRoute(app);
  registerDownloadsRoute(app);

  return app;
}
