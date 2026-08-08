import { cached, UpstreamNotFoundError } from "../cache.js";
import type { DependencyGraph, DependencyNode, Ecosystem } from "../types.js";

const DEPS_TTL = 1000 * 60 * 60 * 24; // 24h
const DEPRECATION_CHECK_CONCURRENCY = 8;

// deps.dev calls the Rust ecosystem "cargo", not "crates" or "crates.io".
// Verified: /v3/systems/cargo/packages/serde resolves, as does its :dependencies.
const DEPSDEV_SYSTEM: Record<Ecosystem, string> = { npm: "npm", pypi: "pypi", crates: "cargo" };

interface DepsDevGraph {
  nodes: {
    versionKey: { system: string; name: string; version: string };
    relation: "SELF" | "DIRECT" | "INDIRECT";
    errors?: unknown[];
  }[];
}

interface DepsDevPackage {
  versions: { versionKey: { version: string }; isDefault?: boolean }[];
}

interface DepsDevVersion {
  isDeprecated?: boolean;
}

export async function getDependencyGraph(
  ecosystem: Ecosystem,
  name: string,
  version?: string,
): Promise<DependencyGraph> {
  const system = DEPSDEV_SYSTEM[ecosystem];
  const resolvedVersion = version ?? (await getLatestDepsDevVersion(ecosystem, name));

  return cached(`depsdev:graph:${ecosystem}:${name}:${resolvedVersion}`, DEPS_TTL, async () => {
    const res = await fetch(
      `https://api.deps.dev/v3/systems/${system}/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(resolvedVersion)}:dependencies`,
    );
    if (res.status === 404) {
      throw new UpstreamNotFoundError(`deps.dev has no dependency graph for ${ecosystem}/${name}@${resolvedVersion}`);
    }
    if (!res.ok) throw new Error(`deps.dev error ${res.status} for ${name}`);
    const doc = (await res.json()) as DepsDevGraph;

    // Deprecation is checked for direct dependencies only (bounded, typically
    // < 30 packages). Checking every transitive dependency would mean one
    // upstream call per node (often 100s), which is too slow/expensive for a
    // single paid request — a known Day-1 limitation, not attempted here.
    const directNodes = doc.nodes.filter((n) => n.relation === "DIRECT");
    const deprecatedDirect = await checkDeprecatedInBatches(system, directNodes);

    const nodes: DependencyNode[] = doc.nodes.map((n) => ({
      name: n.versionKey.name,
      version: n.versionKey.version,
      relation: n.relation,
      deprecated: deprecatedDirect.has(`${n.versionKey.name}@${n.versionKey.version}`),
    }));

    return {
      ecosystem,
      name,
      version: resolvedVersion,
      directCount: nodes.filter((n) => n.relation === "DIRECT").length,
      transitiveCount: nodes.filter((n) => n.relation === "INDIRECT").length,
      deprecatedCount: nodes.filter((n) => n.deprecated).length,
      nodes,
      sourceAttribution: ["deps.dev (Google)"],
    } satisfies DependencyGraph;
  });
}

async function checkDeprecatedInBatches(
  system: string,
  nodes: { versionKey: { name: string; version: string } }[],
): Promise<Set<string>> {
  const deprecated = new Set<string>();
  for (let i = 0; i < nodes.length; i += DEPRECATION_CHECK_CONCURRENCY) {
    const batch = nodes.slice(i, i + DEPRECATION_CHECK_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (n) => {
        try {
          const isDeprecated = await cached(
            `depsdev:version:${system}:${n.versionKey.name}:${n.versionKey.version}`,
            DEPS_TTL,
            async () => {
              const res = await fetch(
                `https://api.deps.dev/v3/systems/${system}/packages/${encodeURIComponent(n.versionKey.name)}/versions/${encodeURIComponent(n.versionKey.version)}`,
              );
              if (!res.ok) return { isDeprecated: false };
              const v = (await res.json()) as DepsDevVersion;
              return { isDeprecated: Boolean(v.isDeprecated) };
            },
          );
          return isDeprecated.isDeprecated ? `${n.versionKey.name}@${n.versionKey.version}` : null;
        } catch {
          return null;
        }
      }),
    );
    for (const key of results) if (key) deprecated.add(key);
  }
  return deprecated;
}

async function getLatestDepsDevVersion(ecosystem: Ecosystem, name: string): Promise<string> {
  const system = DEPSDEV_SYSTEM[ecosystem];
  const result = await cached(`depsdev:latest:${ecosystem}:${name}`, DEPS_TTL, async () => {
    const res = await fetch(`https://api.deps.dev/v3/systems/${system}/packages/${encodeURIComponent(name)}`);
    if (res.status === 404) throw new UpstreamNotFoundError(`deps.dev has no package ${ecosystem}/${name}`);
    if (!res.ok) throw new Error(`deps.dev error ${res.status} for ${name}`);
    const doc = (await res.json()) as DepsDevPackage;
    // deps.dev's `versions` array is not reliably ordered by release, but it
    // flags the true latest/default release via `isDefault` (confirmed by
    // probing the "requests" package, where the last array element was a
    // 10-year-old 2.9.2 while isDefault correctly pointed at 2.34.2).
    const latest = doc.versions.find((v) => v.isDefault) ?? doc.versions.at(-1);
    if (!latest) throw new UpstreamNotFoundError(`deps.dev has no versions for ${ecosystem}/${name}`);
    return { version: latest.versionKey.version };
  });
  return result.version;
}
