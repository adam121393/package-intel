/**
 * Single source of truth for the paid surface: price, description, and the
 * sample input/output used for Bazaar discovery and the public manifest.
 *
 * Keeping this in one place means the payment middleware, the /.well-known
 * manifest, and the Bazaar declarations cannot drift apart — a mismatch
 * between advertised and charged price is the kind of bug that silently
 * breaks indexing or, worse, misprices calls.
 */

export interface CatalogEntry {
  /** Route key in "METHOD /path" form, as the x402 middleware expects. */
  route: string;
  price: string;
  description: string;
  /**
   * Sample request. For path-param routes this MUST use a real, valid
   * ecosystem + package: the Bazaar probes an endpoint with exactly this
   * input and only indexes it if the response is a 402. Our validation
   * middleware 400s on unknown ecosystems, so a placeholder like
   * ":ecosystem" here would silently prevent listing.
   */
  pathParams?: Record<string, string>;
  queryParams?: Record<string, unknown>;
  body?: Record<string, unknown>;
  bodyType?: "json";
  outputExample: unknown;
}

/**
 * Must accompany any `pathParams` in a Bazaar declaration. `declareDiscoveryExtension`
 * only adds `pathParams` to the generated JSON schema's allowed properties when a
 * schema is supplied; omit it and the declaration emits `pathParams` while the schema
 * forbids it (`additionalProperties: false`), so the route is rejected as invalid and
 * never gets catalogued.
 */
export const PATH_PARAMS_SCHEMA = {
  properties: {
    ecosystem: { type: "string", enum: ["npm", "pypi"] },
    name: { type: "string" },
  },
  required: ["ecosystem", "name"],
};

const HEALTH_EXAMPLE = {
  ecosystem: "npm",
  name: "express",
  version: "5.2.1",
  score: 96,
  subscores: { maintenance: 100, popularity: 100, security: 100, freshness: 80 },
  signals: {
    weeklyDownloads: 126125592,
    lastPublish: "2025-12-01T20:49:43.268Z",
    openVulnerabilities: 0,
    deprecated: false,
    license: "MIT",
    maintainers: 5,
  },
  rationale: "Actively maintained. Popular package with substantial download volume. No known vulnerabilities in the latest version.",
  sourceAttribution: ["npm registry", "OSV.dev"],
};

export const CATALOG: CatalogEntry[] = [
  {
    route: "GET /v1/package/:ecosystem/:name",
    price: "$0.005",
    description:
      "Consolidated npm/PyPI package snapshot: latest version, license, description, repository, weekly downloads, maintainer count, last publish date, deprecation status.",
    pathParams: { ecosystem: "npm", name: "express" },
    outputExample: {
      ecosystem: "npm",
      name: "express",
      version: "5.2.1",
      license: "MIT",
      description: "Fast, unopinionated, minimalist web framework",
      repository: "git+https://github.com/expressjs/express.git",
      weeklyDownloads: 126125592,
      lastPublish: "2025-12-01T20:49:43.268Z",
      maintainerCount: 5,
      deprecated: false,
    },
  },
  {
    route: "GET /v1/health/:ecosystem/:name",
    price: "$0.01",
    description:
      "Package health & risk score (0-100) for an npm or PyPI package, with maintenance/popularity/security/freshness sub-scores and a human-readable rationale. Vulnerabilities are scoped to the current version.",
    pathParams: { ecosystem: "npm", name: "express" },
    outputExample: HEALTH_EXAMPLE,
  },
  {
    route: "GET /v1/vulns/:ecosystem/:name",
    price: "$0.01",
    description:
      "Known vulnerabilities from OSV.dev for an npm or PyPI package. Pass ?version= to scope results to a specific version; omit it for all advisories ever filed against the package.",
    pathParams: { ecosystem: "npm", name: "express" },
    queryParams: { version: "5.2.1" },
    outputExample: {
      ecosystem: "npm",
      name: "express",
      version: "5.2.1",
      vulns: [],
      sourceAttribution: ["OSV.dev"],
    },
  },
  {
    route: "GET /v1/deps/:ecosystem/:name",
    price: "$0.02",
    description:
      "Dependency graph from deps.dev for an npm or PyPI package: direct and transitive dependencies with versions, counts, and deprecated direct dependencies flagged.",
    pathParams: { ecosystem: "npm", name: "express" },
    queryParams: { version: "5.2.1" },
    outputExample: {
      ecosystem: "npm",
      name: "express",
      version: "5.2.1",
      directCount: 28,
      transitiveCount: 41,
      deprecatedCount: 0,
      nodes: [{ name: "accepts", version: "2.0.0", relation: "DIRECT", deprecated: false }],
      sourceAttribution: ["deps.dev (Google)"],
    },
  },
  {
    route: "GET /v1/downloads/:ecosystem/:name",
    price: "$0.002",
    description:
      "Download counts for an npm or PyPI package. npm supports ?range=last-day|last-week|last-month|last-year; PyPI returns last-week.",
    pathParams: { ecosystem: "npm", name: "express" },
    queryParams: { range: "last-week" },
    outputExample: {
      ecosystem: "npm",
      name: "express",
      range: "last-week",
      downloads: 126125592,
      start: "2026-07-24",
      end: "2026-07-30",
    },
  },
  {
    route: "POST /v1/batch",
    price: "$0.02",
    description:
      "Batched health scores for up to 50 npm/PyPI packages in one call — designed for scoring an entire dependency manifest (package.json / requirements.txt) at once.",
    bodyType: "json",
    body: {
      queries: [
        { ecosystem: "npm", name: "express" },
        { ecosystem: "pypi", name: "requests" },
      ],
    },
    outputExample: { results: [{ ...HEALTH_EXAMPLE, found: true }] },
  },
];

export const SERVICE_TAGS = [
  "npm",
  "pypi",
  "dependencies",
  "package-health",
  "security",
  "vulnerabilities",
  "sbom",
  "developer-tools",
];
