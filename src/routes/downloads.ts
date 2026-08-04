import type { Hono } from "hono";
import { getNpmDownloads } from "../sources/npmRegistry.js";
import { getPypiDownloads } from "../sources/pypi.js";
import { parseEcosystem, withUpstreamErrors } from "./helpers.js";

const NPM_RANGES = new Set(["last-day", "last-week", "last-month", "last-year"]);

export function registerDownloadsRoute(app: Hono) {
  app.get("/v1/downloads/:ecosystem/:name", (c) =>
    withUpstreamErrors(c, async () => {
      const ecosystem = parseEcosystem(c.req.param("ecosystem"))!;
      const name = c.req.param("name");
      const requestedRange = c.req.query("range") ?? "last-week";

      if (ecosystem === "npm") {
        const range = NPM_RANGES.has(requestedRange) ? requestedRange : "last-week";
        const series = await getNpmDownloads(name, range);
        return c.json({ ...series, cachedAt: new Date().toISOString() });
      }

      // pypistats' public "recent" endpoint only exposes day/week/month buckets.
      const series = await getPypiDownloads(name);
      return c.json({ ...series, cachedAt: new Date().toISOString() });
    }),
  );
}
