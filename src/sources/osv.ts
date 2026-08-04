import { cached } from "../cache.js";
import type { Ecosystem, VulnReport } from "../types.js";

const VULN_TTL = 1000 * 60 * 60; // 1h

const OSV_ECOSYSTEM: Record<Ecosystem, string> = { npm: "npm", pypi: "PyPI" };

interface OsvVuln {
  id: string;
  summary?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
  references?: { url: string }[];
}

export async function getVulnerabilities(
  ecosystem: Ecosystem,
  name: string,
  version?: string,
): Promise<VulnReport> {
  return cached(`osv:${ecosystem}:${name}:${version ?? ""}`, VULN_TTL, async () => {
    const res = await fetch("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        package: { name, ecosystem: OSV_ECOSYSTEM[ecosystem] },
        ...(version ? { version } : {}),
      }),
    });
    if (!res.ok) throw new Error(`OSV.dev error ${res.status} for ${name}`);
    const doc = (await res.json()) as { vulns?: OsvVuln[] };

    return {
      ecosystem,
      name,
      version,
      vulns: (doc.vulns ?? []).map((v) => ({
        id: v.id,
        summary: v.summary ?? null,
        severity: v.database_specific?.severity ?? null,
        aliases: v.aliases ?? [],
        references: (v.references ?? []).map((r) => r.url),
      })),
      sourceAttribution: ["OSV.dev"],
    } satisfies VulnReport;
  });
}
