import type { Hono } from "hono";
import { getNpmDownloads } from "../sources/npmRegistry.js";
import { getDownloads } from "../sources/registry.js";
import { parseEcosystem, withUpstreamErrors } from "./helpers.js";

const NPM_RANGES = new Set(["last-day", "last-week", "last-month", "last-year"]);

export function registerDownloadsRoute(app: Hono) {
  app.get("/v1/downloads/:ecosystem/:name", (c) =>
    withUpstreamErrors(c, async () => {
      const ecosystem = parseEcosystem(c.req.param("ecosystem"))!;
      const name = c.req.param("name");
      const requestedRange = c.req.query("range") ?? "last-week";

      // npm is the only upstream with a selectable window. pypistats' public
      // "recent" endpoint returns fixed buckets, and crates.io reports a ~90-day
      // total; both ignore ?range and report the window they actually measured
      // in the response, so the caller is never misled about the period.
      if (ecosystem === "npm") {
        const range = NPM_RANGES.has(requestedRange) ? requestedRange : "last-week";
        const series = await getNpmDownloads(name, range);
        return c.json({ ...series, cachedAt: new Date().toISOString() });
      }

      const series = await getDownloads[ecosystem](name);
      return c.json({ ...series, cachedAt: new Date().toISOString() });
    }),
  );
}
