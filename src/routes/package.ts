import type { Hono } from "hono";
import { getNpmDownloads, getNpmSnapshot } from "../sources/npmRegistry.js";
import { getPypiDownloads, getPypiSnapshot } from "../sources/pypi.js";
import { parseEcosystem, withUpstreamErrors } from "./helpers.js";

export function registerPackageRoute(app: Hono) {
  app.get("/v1/package/:ecosystem/:name", (c) =>
    withUpstreamErrors(c, async () => {
      const ecosystem = parseEcosystem(c.req.param("ecosystem"))!;
      const name = c.req.param("name");

      const [snapshot, downloads] = await Promise.all([
        ecosystem === "npm" ? getNpmSnapshot(name) : getPypiSnapshot(name),
        (ecosystem === "npm" ? getNpmDownloads(name) : getPypiDownloads(name)).catch(() => null),
      ]);

      return c.json({
        ...snapshot,
        weeklyDownloads: downloads?.downloads ?? snapshot.weeklyDownloads,
        sourceAttribution:
          ecosystem === "npm" ? ["npm registry"] : ["PyPI"],
        cachedAt: new Date().toISOString(),
      });
    }),
  );
}
