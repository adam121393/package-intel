import type { Hono } from "hono";
import { getVulnerabilities } from "../sources/osv.js";
import { parseEcosystem, withUpstreamErrors } from "./helpers.js";

export function registerVulnsRoute(app: Hono) {
  app.get("/v1/vulns/:ecosystem/:name", (c) =>
    withUpstreamErrors(c, async () => {
      const ecosystem = parseEcosystem(c.req.param("ecosystem"))!;
      const name = c.req.param("name");
      const version = c.req.query("version");

      const report = await getVulnerabilities(ecosystem, name, version);
      return c.json({ ...report, cachedAt: new Date().toISOString() });
    }),
  );
}
