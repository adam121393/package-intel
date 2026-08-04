import { cached, UpstreamNotFoundError } from "../cache.js";
import type { DownloadSeries, PackageSnapshot } from "../types.js";

const SNAPSHOT_TTL = 1000 * 60 * 60 * 12; // 12h
const DOWNLOADS_TTL = 1000 * 60 * 60 * 24; // 24h

interface PypiDoc {
  info: {
    version: string;
    license?: string | null;
    summary?: string | null;
    project_urls?: Record<string, string> | null;
    yanked?: boolean;
    yanked_reason?: string | null;
  };
  urls: { upload_time_iso_8601?: string }[];
}

export async function getPypiSnapshot(name: string): Promise<PackageSnapshot> {
  return cached(`pypi:snapshot:${name}`, SNAPSHOT_TTL, async () => {
    const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (res.status === 404) throw new UpstreamNotFoundError(`PyPI package not found: ${name}`);
    if (!res.ok) throw new Error(`PyPI error ${res.status} for ${name}`);
    const doc = (await res.json()) as PypiDoc;

    const repository =
      doc.info.project_urls?.Source ??
      doc.info.project_urls?.Homepage ??
      doc.info.project_urls?.Repository ??
      null;
    const lastPublish = doc.urls?.[0]?.upload_time_iso_8601 ?? null;

    return {
      ecosystem: "pypi",
      name,
      version: doc.info.version,
      license: doc.info.license || null,
      description: doc.info.summary ?? null,
      repository,
      weeklyDownloads: null, // filled in by getPypiDownloads when needed
      lastPublish,
      maintainerCount: null, // not exposed in a countable form by the PyPI JSON API
      deprecated: Boolean(doc.info.yanked),
      deprecatedReason: doc.info.yanked_reason ?? null,
    } satisfies PackageSnapshot;
  });
}

export async function getPypiDownloads(name: string): Promise<DownloadSeries> {
  return cached(`pypi:downloads:${name}`, DOWNLOADS_TTL, async () => {
    const res = await fetch(`https://pypistats.org/api/packages/${encodeURIComponent(name)}/recent`);
    if (res.status === 404) throw new UpstreamNotFoundError(`PyPI package not found: ${name}`);
    if (!res.ok) throw new Error(`pypistats error ${res.status} for ${name}`);
    const doc = (await res.json()) as { data: { last_week: number } };

    return {
      ecosystem: "pypi",
      name,
      range: "last-week",
      downloads: doc.data.last_week,
      start: null,
      end: null,
    } satisfies DownloadSeries;
  });
}
