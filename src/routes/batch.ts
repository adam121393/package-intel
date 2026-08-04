import type { Hono } from "hono";
import { z } from "zod";
import { UpstreamNotFoundError } from "../cache.js";
import { computeHealthScore } from "../domain/health.js";
import { getNpmDownloads, getNpmSnapshot } from "../sources/npmRegistry.js";
import { getVulnerabilities } from "../sources/osv.js";
import { getPypiDownloads, getPypiSnapshot } from "../sources/pypi.js";

const BatchQuerySchema = z.object({
  ecosystem: z.enum(["npm", "pypi"]),
  name: z.string().min(1).max(214),
});

const BatchBodySchema = z.object({
  queries: z.array(BatchQuerySchema).min(1).max(50),
});

export function registerBatchRoute(app: Hono) {
  app.post("/v1/batch", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Request body must be valid JSON" }, 400);
    }

    const parsed = BatchBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid batch request", details: parsed.error.issues }, 400);
    }

    // Structural validation passed above 400-out before any of this runs, so
    // that path is never charged. From here the request is well-formed, so
    // the batch is billed as a whole even if individual packages turn out
    // not to exist — each result item reports its own `found` status.
    const results = await Promise.all(
      parsed.data.queries.map(async ({ ecosystem, name }) => {
        try {
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
          return { ...health, found: true };
        } catch (err) {
          if (err instanceof UpstreamNotFoundError) {
            return { ecosystem, name, found: false, error: "not found" };
          }
          return { ecosystem, name, found: false, error: "upstream unavailable" };
        }
      }),
    );

    return c.json({ results, cachedAt: new Date().toISOString() });
  });
}
