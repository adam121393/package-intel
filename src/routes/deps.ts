import type { Hono } from "hono";
import { getDependencyGraph } from "../sources/depsdev.js";
import { parseEcosystem, withUpstreamErrors } from "./helpers.js";

export function registerDepsRoute(app: Hono) {
  app.get("/v1/deps/:ecosystem/:name", (c) =>
    withUpstreamErrors(c, async () => {
      const ecosystem = parseEcosystem(c.req.param("ecosystem"))!;
      const name = c.req.param("name");
      const version = c.req.query("version");

      const graph = await getDependencyGraph(ecosystem, name, version);
      return c.json({ ...graph, cachedAt: new Date().toISOString() });
    }),
  );
}
