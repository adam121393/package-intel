import { facilitator as cdpFacilitator } from "@coinbase/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { Hono } from "hono";
import { freeRouteSegments, paidEntries, PATH_PARAMS_SCHEMA, SERVICE_TAGS } from "./catalog.js";
import { getConfig } from "./config.js";
import { RateLimiter, resolveRateLimitKey } from "./rateLimit.js";
import { registerBatchRoute } from "./routes/batch.js";
import { registerDepsRoute } from "./routes/deps.js";
import { registerDiscoveryRoutes } from "./routes/discovery.js";
import { registerDownloadsRoute } from "./routes/downloads.js";
import { registerHealthRoute } from "./routes/health.js";
import { ecosystemList, parseEcosystem } from "./routes/helpers.js";
import { registerPackageRoute } from "./routes/package.js";
import { registerVulnsRoute } from "./routes/vulns.js";

/**
 * Builds the Hono app. Called lazily rather than at module scope so it works on
 * Cloudflare Workers, where environment bindings are not guaranteed to be
 * populated while modules are still being evaluated.
 */
export function createApp(): Hono {
  const config = getConfig();
  const app = new Hono();

  registerDiscoveryRoutes(app);

  // Reject unsupported ecosystems before payment is ever checked, per the build
  // spec's "reject before settle" guidance. Runs before paymentMiddleware since
  // Hono executes app.use() middleware in registration order. /v1/batch and
  // /v1/sample are exempt: batch validates its own body, sample is free.
  app.use("/v1/*", async (c, next) => {
    const segments = c.req.path.split("/").filter(Boolean);
    const isPathParamRoute = segments.length >= 3 && segments[0] === "v1";
    if (isPathParamRoute && segments[1] !== "batch" && segments[1] !== "sample") {
      const ecosystem = segments[2] ?? "";
      // Uses parseEcosystem rather than its own literal list: this check and the
      // handlers must never disagree about what is supported, or a newly added
      // ecosystem 400s here before reaching a handler that would have served it.
      if (!parseEcosystem(ecosystem)) {
        return c.json(
          { error: `Unsupported ecosystem '${ecosystem}'. Must be ${ecosystemList()}.` },
          400,
        );
      }
    }
    await next();
  });

  // Free routes are metered so a runaway agent loop cannot get our egress IP
  // blocked by npm/OSV/deps.dev. Paid routes are exempt: their price is the
  // limiter. The set is derived from the catalog so retiering an endpoint
  // cannot leave the limiter pointed at the wrong routes.
  const limiter = new RateLimiter();
  const freeSegments = freeRouteSegments();

  app.use("/v1/*", async (c, next) => {
    const segment = c.req.path.split("/").filter(Boolean)[1];
    if (!segment || !freeSegments.has(segment)) return next();

    const verdict = limiter.check(resolveRateLimitKey(c.req.raw.headers, config.proxySecret));
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

  // On mainnet the CDP facilitator settles real USDC and auto-catalogs this
  // service in the Bazaar on first successful settlement. Testnet uses the
  // public no-auth facilitator unless USE_CDP_FACILITATOR opts in.
  const facilitatorConfig = config.useCdpFacilitator ? cdpFacilitator : { url: config.facilitatorUrl };
  const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);
  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    config.network,
    new ExactEvmScheme(),
  );

  // Only paid entries get a payment requirement; free ones are simply absent
  // from the map, so the middleware passes them straight through.
  const routes = Object.fromEntries(
    paidEntries().map((entry) => [
      entry.route,
      {
        accepts: {
          scheme: "exact" as const,
          price: entry.price,
          network: config.network,
          payTo: config.payTo,
        },
        description: entry.description,
        mimeType: "application/json",
        serviceName: config.serviceName,
        tags: SERVICE_TAGS,
        extensions: config.bazaarEnabled
          ? {
              // The HTTP method is inferred from the route key by the extension,
              // so it is deliberately not passed here.
              ...declareDiscoveryExtension({
                ...(entry.pathParams
                  ? { pathParams: entry.pathParams, pathParamsSchema: PATH_PARAMS_SCHEMA }
                  : {}),
                ...(entry.queryParams ? { input: entry.queryParams } : {}),
                ...(entry.body ? { input: entry.body } : {}),
                ...(entry.bodyType ? { bodyType: entry.bodyType } : {}),
                output: { example: entry.outputExample },
              }),
            }
          : {},
      },
    ]),
  );

  // syncFacilitatorOnStart (arg 5) is disabled on runtimes where a blocking
  // startup round-trip to the facilitator is undesirable.
  app.use(paymentMiddleware(routes, resourceServer, undefined, undefined, config.syncFacilitator));

  registerPackageRoute(app);
  registerHealthRoute(app);
  registerVulnsRoute(app);
  registerDepsRoute(app);
  registerDownloadsRoute(app);
  registerBatchRoute(app);

  return app;
}
