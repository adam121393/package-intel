import type { Hono } from "hono";
import { z } from "zod";
import { UpstreamNotFoundError } from "../cache.js";
import { computeHealthScore } from "../domain/health.js";
import { getVulnerabilities } from "../sources/osv.js";
import {
  ECOSYSTEMS,
  getDownloads,
  getSnapshot,
  REGISTRY_ATTRIBUTION,
} from "../sources/registry.js";
import type { Ecosystem } from "../types.js";

// Built from ECOSYSTEMS rather than repeating the literals: a zod enum is not
// derived from the Ecosystem type, so a hand-written list here would silently
// keep rejecting an ecosystem the rest of the service already supports.
const BatchQuerySchema = z.object({
  ecosystem: z.enum(ECOSYSTEMS as [Ecosystem, ...Ecosystem[]]),
  name: z.string().min(1).max(214),
});

const BatchBodySchema = z.object({
  queries: z.array(BatchQuerySchema).min(1).max(50),
  // Consumed by the payment gate before this handler runs. Declared so it is a
  // documented part of the request rather than an unknown key, and so a future
  // switch to a strict schema would not start rejecting paying callers.
  tx_hash: z.string().optional(),
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
          const snapshot = await getSnapshot[ecosystem](name);
          const [downloads, vulnReport] = await Promise.all([
            getDownloads[ecosystem](name).catch(() => null),
            getVulnerabilities(ecosystem, name, snapshot.version),
          ]);
          // See health.ts: only a genuinely weekly figure may replace the
          // snapshot's own, or crates' 90-day total would skew popularity.
          const weeklyDownloads = snapshot.weeklyDownloadsIsEstimate
            ? snapshot.weeklyDownloads
            : (downloads?.downloads ?? null);
          const health = computeHealthScore(
            { ...snapshot, weeklyDownloads },
            vulnReport.vulns,
            [REGISTRY_ATTRIBUTION[ecosystem], "OSV.dev"],
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
