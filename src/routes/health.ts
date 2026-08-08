import type { Hono } from "hono";
import { computeHealthScore } from "../domain/health.js";
import { getVulnerabilities } from "../sources/osv.js";
import { getDownloads, getSnapshot, REGISTRY_ATTRIBUTION } from "../sources/registry.js";
import { parseEcosystem, withUpstreamErrors } from "./helpers.js";

export function registerHealthRoute(app: Hono) {
  app.get("/v1/health/:ecosystem/:name", (c) =>
    withUpstreamErrors(c, async () => {
      const ecosystem = parseEcosystem(c.req.param("ecosystem"))!;
      const name = c.req.param("name");

      // Snapshot must resolve first so vulns can be scoped to the actual
      // latest version — querying OSV without a version returns every
      // advisory ever filed against the package across all history.
      const snapshot = await getSnapshot[ecosystem](name);
      const [downloads, vulnReport] = await Promise.all([
        getDownloads[ecosystem](name).catch(() => null),
        getVulnerabilities(ecosystem, name, snapshot.version),
      ]);

      // Only take the downloads figure when it is genuinely weekly. For crates
      // the snapshot's estimate is the weekly-comparable number; the downloads
      // endpoint reports a 90-day total, which would inflate popularity.
      const weeklyDownloads = snapshot.weeklyDownloadsIsEstimate
        ? snapshot.weeklyDownloads
        : (downloads?.downloads ?? null);

      const health = computeHealthScore(
        { ...snapshot, weeklyDownloads },
        vulnReport.vulns,
        [REGISTRY_ATTRIBUTION[ecosystem], "OSV.dev"],
      );

      return c.json({ ...health, cachedAt: new Date().toISOString() });
    }),
  );
}
