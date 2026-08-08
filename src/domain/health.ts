import type { HealthScore, PackageSnapshot, VulnRecord } from "../types.js";

/**
 * v1 heuristic scoring — a documented starting point, not a final algorithm.
 * Each subscore is 0-100; overall score is a weighted average. Weights and
 * thresholds are intentionally simple and tunable as real usage data comes in.
 */
const WEIGHTS = { freshness: 0.2, popularity: 0.25, security: 0.35, maintenance: 0.2 };

const SEVERITY_PENALTY: Record<string, number> = {
  CRITICAL: 40,
  HIGH: 25,
  MODERATE: 12,
  MEDIUM: 12,
  LOW: 5,
};

function scoreFreshness(lastPublish: string | null): number {
  if (!lastPublish) return 40; // unknown — mildly penalize rather than assume the best or worst
  const days = (Date.now() - new Date(lastPublish).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 0) return 100;
  if (days <= 90) return 100;
  if (days <= 365) return 80;
  if (days <= 365 * 2) return 55;
  if (days <= 365 * 4) return 30;
  return 15;
}

function scorePopularity(weeklyDownloads: number | null): number {
  if (weeklyDownloads === null || weeklyDownloads <= 0) return 30; // unknown/unranked, not necessarily bad
  // log-scaled: ~100 downloads/week -> ~40, ~1M/week -> ~100
  const scaled = (Math.log10(weeklyDownloads + 1) / 7) * 100;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

function scoreSecurity(vulns: VulnRecord[]): number {
  if (vulns.length === 0) return 100;
  const penalty = vulns.reduce((sum, v) => sum + (SEVERITY_PENALTY[(v.severity ?? "").toUpperCase()] ?? 10), 0);
  return Math.max(0, 100 - penalty);
}

function scoreMaintenance(snapshot: PackageSnapshot): number {
  let score = 100;
  if (snapshot.deprecated) score -= 60;
  if (snapshot.maintainerCount !== null && snapshot.maintainerCount === 0) score -= 20;
  if (!snapshot.license) score -= 10;
  return Math.max(0, score);
}

export function computeHealthScore(
  snapshot: PackageSnapshot,
  vulns: VulnRecord[],
  sourceAttribution: string[],
): HealthScore {
  const subscores = {
    freshness: scoreFreshness(snapshot.lastPublish),
    popularity: scorePopularity(snapshot.weeklyDownloads),
    security: scoreSecurity(vulns),
    maintenance: scoreMaintenance(snapshot),
  };

  const score = Math.round(
    subscores.freshness * WEIGHTS.freshness +
      subscores.popularity * WEIGHTS.popularity +
      subscores.security * WEIGHTS.security +
      subscores.maintenance * WEIGHTS.maintenance,
  );

  const notes: string[] = [];
  notes.push(
    snapshot.deprecated
      ? "Package is marked deprecated."
      : subscores.maintenance >= 90
        ? "Actively maintained."
        : "Maintenance signals are mixed.",
  );
  notes.push(
    subscores.popularity >= 70
      ? "Popular package with substantial download volume."
      : "Modest download volume.",
  );
  notes.push(vulns.length === 0 ? "No known vulnerabilities in the latest version." : `${vulns.length} known vulnerabilit${vulns.length === 1 ? "y" : "ies"} found.`);
  notes.push(
    subscores.freshness >= 80 ? "Recently published." : "Has not been published recently.",
  );

  return {
    ecosystem: snapshot.ecosystem,
    name: snapshot.name,
    version: snapshot.version,
    score,
    subscores,
    signals: {
      weeklyDownloads: snapshot.weeklyDownloads,
      // Propagated so a caller can tell a reported weekly count from a rate
      // derived off a longer window (crates.io publishes no weekly figure).
      ...(snapshot.weeklyDownloadsIsEstimate ? { weeklyDownloadsIsEstimate: true } : {}),
      lastPublish: snapshot.lastPublish,
      openVulnerabilities: vulns.length,
      deprecated: snapshot.deprecated,
      license: snapshot.license,
      maintainers: snapshot.maintainerCount,
    },
    rationale: notes.join(" "),
    sourceAttribution,
  } satisfies HealthScore;
}
