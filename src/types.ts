export type Ecosystem = "npm" | "pypi";

export interface PackageSnapshot {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  license: string | null;
  description: string | null;
  repository: string | null;
  weeklyDownloads: number | null;
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
    lastPublish: string | null;
    openVulnerabilities: number;
    deprecated: boolean;
    license: string | null;
    maintainers: number | null;
  };
  rationale: string;
  sourceAttribution: string[];
}
