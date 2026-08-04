import { cached, UpstreamNotFoundError } from "../cache.js";
import type { DownloadSeries, PackageSnapshot } from "../types.js";

const SNAPSHOT_TTL = 1000 * 60 * 60 * 12; // 12h
const DOWNLOADS_TTL = 1000 * 60 * 60 * 24; // 24h

interface NpmRegistryDoc {
  "dist-tags": { latest: string };
  versions: Record<
    string,
    {
      version: string;
      license?: string | { type: string };
      description?: string;
      repository?: { url?: string } | string;
      deprecated?: string;
      maintainers?: { name: string }[];
    }
  >;
  time: Record<string, string>;
}

export async function getNpmSnapshot(name: string): Promise<PackageSnapshot> {
  return cached(`npm:snapshot:${name}`, SNAPSHOT_TTL, async () => {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    if (res.status === 404) throw new UpstreamNotFoundError(`npm package not found: ${name}`);
    if (!res.ok) throw new Error(`npm registry error ${res.status} for ${name}`);
    const doc = (await res.json()) as NpmRegistryDoc;

    const latest = doc["dist-tags"]?.latest;
    const versionDoc = latest ? doc.versions?.[latest] : undefined;
    if (!latest || !versionDoc) throw new UpstreamNotFoundError(`npm package has no latest version: ${name}`);

    const license =
      typeof versionDoc.license === "string" ? versionDoc.license : (versionDoc.license?.type ?? null);
    const repository =
      typeof versionDoc.repository === "string" ? versionDoc.repository : (versionDoc.repository?.url ?? null);

    return {
      ecosystem: "npm",
      name,
      version: latest,
      license,
      description: versionDoc.description ?? null,
      repository,
      weeklyDownloads: null, // filled in by getNpmDownloads when needed
      lastPublish: doc.time?.[latest] ?? null,
      maintainerCount: versionDoc.maintainers?.length ?? null,
      deprecated: Boolean(versionDoc.deprecated),
      deprecatedReason: versionDoc.deprecated ?? null,
    } satisfies PackageSnapshot;
  });
}

export async function getNpmDownloads(name: string, range = "last-week"): Promise<DownloadSeries> {
  return cached(`npm:downloads:${range}:${name}`, DOWNLOADS_TTL, async () => {
    const res = await fetch(`https://api.npmjs.org/downloads/point/${range}/${encodeURIComponent(name)}`);
    if (res.status === 404) throw new UpstreamNotFoundError(`npm package not found: ${name}`);
    if (!res.ok) throw new Error(`npm downloads error ${res.status} for ${name}`);
    const doc = (await res.json()) as { downloads: number; start: string; end: string };

    return {
      ecosystem: "npm",
      name,
      range,
      downloads: doc.downloads,
      start: doc.start,
      end: doc.end,
    } satisfies DownloadSeries;
  });
}
