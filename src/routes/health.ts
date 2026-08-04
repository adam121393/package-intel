import type { Hono } from "hono";
import { computeHealthScore } from "../domain/health.js";
import { getNpmDownloads, getNpmSnapshot } from "../sources/npmRegistry.js";
import { getVulnerabilities } from "../sources/osv.js";
import { getPypiDownloads, getPypiSnapshot } from "../sources/pypi.js";
import { parseEcosystem, withUpstreamErrors } from "./helpers.js";

export function registerHealthRoute(app: Hono) {
  app.get("/v1/health/:ecosystem/:name", (c) =>
    withUpstreamErrors(c, async () => {
      const ecosystem = parseEcosystem(c.req.param("ecosystem"))!;
      const name = c.req.param("name");

      // Snapshot must resolve first so vulns can be scoped to the actual
      // latest version — querying OSV without a version returns every
      // advisory ever filed against the package across all history.
      const snapshot = ecosystem === "npm" ? await getNpmSnapshot(name) : await getPypiSnapshot(name);
      const [downloads, vulnReport] = await Promise.all([
        (ecosystem === "npm" ? getNpmDownloads(name) : getPypiDownloads(name)).catch(() => null),
        getVulnerabilities(ecosystem, name, snapshot.version),
      ]);

      const health = computeHealthScore(
        { ...snapshot, weeklyDownloads: downloads?.downloads ?? null },
        vulnReport.vulns,
        [ecosystem === "npm" ? "npm registry" : "PyPI", "OSV.dev"],
      );

      return c.json({ ...health, cachedAt: new Date().toISOString() });
    }),
  );
}
