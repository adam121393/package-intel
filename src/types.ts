/**
 * Public ecosystem identifiers, used as the `:ecosystem` path segment. These are
 * our own names, deliberately dot-free and lowercase; each upstream spells them
 * differently ("crates" is "crates.io" to OSV and "cargo" to deps.dev), and those
 * mappings live in exhaustive Records next to the source that needs them, so
 * adding a member here fails the build until every mapping is filled in.
 */
export type Ecosystem = "npm" | "pypi" | "crates";

export interface PackageSnapshot {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  license: string | null;
  description: string | null;
  repository: string | null;
  weeklyDownloads: number | null;
  /**
   * True when `weeklyDownloads` was derived rather than reported. crates.io
   * publishes only all-time and ~90-day totals, so a weekly figure for a crate
   * is a rate estimate. The health scorer's popularity curve is calibrated on
   * weekly counts, so feeding it a 90-day total would inflate every crate;
   * normalising keeps ecosystems comparable, and this flag keeps that honest
   * to the caller instead of silently relabelling a 90-day number as weekly.
   */
  weeklyDownloadsIsEstimate?: boolean;
  lastPublish: string | null;
  maintainerCount: number | null;
  deprecated: boolean;
  deprecatedReason: string | null;
}

export interface DownloadSeries {
  ecosystem: Ecosystem;
  name: string;
  range: string;
  downloads: number;
  start: string | null;
  end: string | null;
}

export interface VulnRecord {
  id: string;
  summary: string | null;
  severity: string | null;
  aliases: string[];
  references: string[];
}

export interface VulnReport {
  ecosystem: Ecosystem;
  name: string;
  version?: string;
  vulns: VulnRecord[];
  sourceAttribution: string[];
}

export interface DependencyNode {
  name: string;
  version: string;
  relation: "SELF" | "DIRECT" | "INDIRECT";
  deprecated: boolean;
}

export interface DependencyGraph {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  directCount: number;
  transitiveCount: number;
  deprecatedCount: number;
  nodes: DependencyNode[];
  sourceAttribution: string[];
}

export interface HealthScore {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  score: number;
  subscores: {
    maintenance: number;
    popularity: number;
    security: number;
    freshness: number;
  };
  signals: {
    weeklyDownloads: number | null;
    /** See PackageSnapshot.weeklyDownloadsIsEstimate. */
    weeklyDownloadsIsEstimate?: boolean;
    lastPublish: string | null;
    openVulnerabilities: number;
    deprecated: boolean;
    license: string | null;
    maintainers: number | null;
  };
  rationale: string;
  sourceAttribution: string[];
}
