import { UpstreamNotFoundError } from "../cache.js";
import { getDependencyGraph } from "../sources/depsdev.js";
import { getVulnerabilities } from "../sources/osv.js";
import { getDownloads, getSnapshot, REGISTRY_ATTRIBUTION } from "../sources/registry.js";
import type { Ecosystem } from "../types.js";
import { computeHealthScore } from "./health.js";

/**
 * One package, flattened into a single row.
 *
 * The API and the MCP tools return one nested document per endpoint, which
 * suits an agent reading a single answer. A dataset consumer wants the opposite:
 * one flat row per package, every column present on every row, so it opens in a
 * spreadsheet or loads into a table without reshaping.
 *
 * Lives here rather than in the Actor so the health score has exactly one
 * implementation. Two copies would mean the same package scoring differently
 * depending on which product you bought it through — hard to notice, and
 * indefensible once someone does.
 */
export interface PackageRow {
  ecosystem: Ecosystem;
  name: string;
  found: boolean;
  error: string | null;

  version: string | null;
  license: string | null;
  description: string | null;
  repository: string | null;
  lastPublish: string | null;
  maintainerCount: number | null;
  deprecated: boolean | null;
  deprecatedReason: string | null;

  weeklyDownloads: number | null;
  /** True when weeklyDownloads was derived from a longer window (crates.io). */
  weeklyDownloadsIsEstimate: boolean;

  vulnerabilityCount: number | null;
  maxSeverity: string | null;
  vulnerabilityIds: string[];

  directDependencies: number | null;
  transitiveDependencies: number | null;
  deprecatedDependencies: number | null;

  healthScore: number | null;
  maintenanceScore: number | null;
  popularityScore: number | null;
  securityScore: number | null;
  freshnessScore: number | null;
  rationale: string | null;

  sources: string[];
  checkedAt: string;
}

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MODERATE: 2,
  MEDIUM: 2,
  LOW: 1,
};

function worstSeverity(vulns: { severity: string | null }[]): string | null {
  let worst: string | null = null;
  let rank = 0;
  for (const v of vulns) {
    const r = SEVERITY_RANK[String(v.severity ?? "").toUpperCase()] ?? 0;
    if (r > rank) {
      rank = r;
      worst = String(v.severity).toUpperCase();
    }
  }
  return worst;
}

/** An unresolvable package still produces a row, so the output stays rectangular. */
function emptyRow(ecosystem: Ecosystem, name: string, error: string): PackageRow {
  return {
    ecosystem,
    name,
    found: false,
    error,
    version: null,
    license: null,
    description: null,
    repository: null,
    lastPublish: null,
    maintainerCount: null,
    deprecated: null,
    deprecatedReason: null,
    weeklyDownloads: null,
    weeklyDownloadsIsEstimate: false,
    vulnerabilityCount: null,
    maxSeverity: null,
    vulnerabilityIds: [],
    directDependencies: null,
    transitiveDependencies: null,
    deprecatedDependencies: null,
    healthScore: null,
    maintenanceScore: null,
    popularityScore: null,
    securityScore: null,
    freshnessScore: null,
    rationale: null,
    sources: [],
    checkedAt: new Date().toISOString(),
  };
}

export interface RowOptions {
  /** Dependency graphs cost an extra upstream call per package, so they are opt-in. */
  includeDependencies?: boolean;
}

export async function buildPackageRow(
  ecosystem: Ecosystem,
  name: string,
  options: RowOptions = {},
): Promise<PackageRow> {
  let snapshot: Awaited<ReturnType<(typeof getSnapshot)[Ecosystem]>>;
  try {
    snapshot = await getSnapshot[ecosystem](name);
  } catch (err) {
    // Not-found is a fact about the package; anything else is our problem or an
    // upstream's. Both produce a row, distinguished by the message.
    return emptyRow(
      ecosystem,
      name,
      err instanceof UpstreamNotFoundError ? "not found" : `upstream error: ${(err as Error).message}`,
    );
  }

  const [downloads, vulnReport, graph] = await Promise.all([
    getDownloads[ecosystem](name).catch(() => null),
    getVulnerabilities(ecosystem, name, snapshot.version).catch(() => null),
    options.includeDependencies
      ? getDependencyGraph(ecosystem, name, snapshot.version).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Only a genuinely weekly figure may replace the snapshot's own. crates.io
  // reports a 90-day total, which would overstate popularity by an order of
  // magnitude if dropped into a field labelled weekly.
  const weeklyDownloads = snapshot.weeklyDownloadsIsEstimate
    ? snapshot.weeklyDownloads
    : (downloads?.downloads ?? snapshot.weeklyDownloads);

  const vulns = vulnReport?.vulns ?? [];
  const health = computeHealthScore({ ...snapshot, weeklyDownloads }, vulns, [
    REGISTRY_ATTRIBUTION[ecosystem],
    "OSV.dev",
  ]);

  const sources = [REGISTRY_ATTRIBUTION[ecosystem]];
  if (vulnReport) sources.push("OSV.dev");
  if (graph) sources.push("deps.dev (Google)");

  return {
    ecosystem,
    name,
    found: true,
    error: null,

    version: snapshot.version,
    license: snapshot.license,
    description: snapshot.description,
    repository: snapshot.repository,
    lastPublish: snapshot.lastPublish,
    maintainerCount: snapshot.maintainerCount,
    deprecated: snapshot.deprecated,
    deprecatedReason: snapshot.deprecatedReason,

    weeklyDownloads,
    weeklyDownloadsIsEstimate: Boolean(snapshot.weeklyDownloadsIsEstimate),

    // null rather than 0 when the advisory lookup itself failed: "no known
    // vulnerabilities" and "we could not check" must not read the same.
    vulnerabilityCount: vulnReport ? vulns.length : null,
    maxSeverity: worstSeverity(vulns),
    vulnerabilityIds: vulns.map((v) => v.id),

    directDependencies: graph?.directCount ?? null,
    transitiveDependencies: graph?.transitiveCount ?? null,
    deprecatedDependencies: graph?.deprecatedCount ?? null,

    healthScore: health.score,
    maintenanceScore: health.subscores.maintenance,
    popularityScore: health.subscores.popularity,
    securityScore: health.subscores.security,
    freshnessScore: health.subscores.freshness,
    rationale: health.rationale,

    sources,
    checkedAt: new Date().toISOString(),
  };
}
