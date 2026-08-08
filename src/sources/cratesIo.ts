import { cached, UpstreamNotFoundError } from "../cache.js";
import type { DownloadSeries, PackageSnapshot } from "../types.js";

const SNAPSHOT_TTL = 1000 * 60 * 60 * 12; // 12h
const DOWNLOADS_TTL = 1000 * 60 * 60 * 24; // 24h

/**
 * crates.io returns 403 to requests without an identifying User-Agent — verified
 * directly, not assumed. Unlike the npm and PyPI sources, which use a headerless
 * fetch, every call here must carry this or the source fails in a way that looks
 * like an outage rather than a policy rejection.
 */
const USER_AGENT = "package-intel/1.0 (https://github.com/adam121393/package-intel)";

/** The window crates.io's `recent_downloads` covers. */
const RECENT_DOWNLOADS_DAYS = 90;

interface CratesVersion {
  num: string;
  license: string | null;
  yanked: boolean;
  yank_message?: string | null;
  created_at: string;
}

interface CratesDoc {
  crate: {
    name: string;
    description: string | null;
    repository: string | null;
    homepage: string | null;
    documentation: string | null;
    downloads: number;
    recent_downloads: number | null;
    newest_version: string;
    max_stable_version: string | null;
    default_version?: string;
    updated_at: string;
  };
  versions: CratesVersion[];
}

async function fetchCrate(name: string): Promise<CratesDoc> {
  const res = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
  });
  if (res.status === 404) throw new UpstreamNotFoundError(`crate not found: ${name}`);
  if (!res.ok) throw new Error(`crates.io error ${res.status} for ${name}`);
  return (await res.json()) as CratesDoc;
}

/** Weekly rate implied by the ~90-day total, so popularity is comparable across ecosystems. */
export function estimateWeeklyFromRecent(recentDownloads: number): number {
  return Math.round((recentDownloads / RECENT_DOWNLOADS_DAYS) * 7);
}

export async function getCratesSnapshot(name: string): Promise<PackageSnapshot> {
  return cached(`crates:snapshot:${name}`, SNAPSHOT_TTL, async () => {
    const doc = await fetchCrate(name);

    // Prefer the newest stable release, falling back to newest overall (a crate
    // with only pre-releases has no max_stable_version). The version array is
    // not relied on for ordering — the same lesson deps.dev taught us — so the
    // chosen version is looked up by name rather than taken positionally.
    const version = doc.crate.max_stable_version ?? doc.crate.newest_version;
    const versionDoc = doc.versions.find((v) => v.num === version) ?? doc.versions[0];
    if (!versionDoc) throw new UpstreamNotFoundError(`crate has no versions: ${name}`);

    const recent = doc.crate.recent_downloads;

    return {
      ecosystem: "crates",
      name,
      version: versionDoc.num,
      // License and yank status are per-version on crates.io, not on the crate
      // object — unlike PyPI, where they sit on `info`.
      license: versionDoc.license || null,
      description: doc.crate.description ?? null,
      repository: doc.crate.repository ?? doc.crate.homepage ?? doc.crate.documentation ?? null,
      weeklyDownloads: recent === null ? null : estimateWeeklyFromRecent(recent),
      weeklyDownloadsIsEstimate: recent !== null,
      lastPublish: versionDoc.created_at ?? doc.crate.updated_at ?? null,
      // crates.io exposes owners via a separate /owners call. Left null rather
      // than spending an extra upstream request per snapshot; the maintenance
      // subscore only penalises an explicit zero, so null is neutral.
      maintainerCount: null,
      deprecated: Boolean(versionDoc.yanked),
      deprecatedReason: versionDoc.yank_message ?? null,
    } satisfies PackageSnapshot;
  });
}

export async function getCratesDownloads(name: string): Promise<DownloadSeries> {
  return cached(`crates:downloads:${name}`, DOWNLOADS_TTL, async () => {
    const doc = await fetchCrate(name);
    const recent = doc.crate.recent_downloads;

    // Reported as the window crates.io actually measures. The weekly figure used
    // for scoring is derived separately, so this endpoint never restates a
    // 90-day total as though it were a week.
    return {
      ecosystem: "crates",
      name,
      range: recent === null ? "all-time" : `last-${RECENT_DOWNLOADS_DAYS}-days`,
      downloads: recent ?? doc.crate.downloads,
      start: null,
      end: null,
    } satisfies DownloadSeries;
  });
}
