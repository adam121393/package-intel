import type { Hono } from "hono";
import { getDownloads, getSnapshot, REGISTRY_ATTRIBUTION } from "../sources/registry.js";
import { parseEcosystem, withUpstreamErrors } from "./helpers.js";

export function registerPackageRoute(app: Hono) {
  app.get("/v1/package/:ecosystem/:name", (c) =>
    withUpstreamErrors(c, async () => {
      const ecosystem = parseEcosystem(c.req.param("ecosystem"))!;
      const name = c.req.param("name");

      const [snapshot, downloads] = await Promise.all([
        getSnapshot[ecosystem](name),
        getDownloads[ecosystem](name).catch(() => null),
      ]);

      // The snapshot already carries a weekly figure for crates (derived from
      // the 90-day total), so only overwrite it when the downloads call returns
      // a genuinely weekly number — otherwise a 90-day count would land in a
      // field labelled weekly.
      const weeklyDownloads = snapshot.weeklyDownloadsIsEstimate
        ? snapshot.weeklyDownloads
        : (downloads?.downloads ?? snapshot.weeklyDownloads);

      return c.json({
        ...snapshot,
        weeklyDownloads,
        sourceAttribution: [REGISTRY_ATTRIBUTION[ecosystem]],
        cachedAt: new Date().toISOString(),
      });
    }),
  );
}
