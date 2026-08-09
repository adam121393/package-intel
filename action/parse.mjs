/**
 * Manifest parsing and verdict logic for the dependency-review action.
 *
 * Kept separate from index.mjs so it can be unit tested: these are the parts
 * that decide which packages get checked and whether a PR is blocked, and both
 * fail silently if wrong — a missed dependency looks identical to a clean one.
 */

/** Manifests we know how to read, mapped to the ecosystem the API expects. */
export const MANIFESTS = [
  { pattern: /(^|\/)package\.json$/, ecosystem: "npm", parse: parsePackageJson },
  { pattern: /(^|\/)requirements[^/]*\.txt$/, ecosystem: "pypi", parse: parseRequirements },
  { pattern: /(^|\/)Cargo\.toml$/, ecosystem: "crates", parse: parseCargoToml },
];

export function manifestFor(path) {
  return MANIFESTS.find((m) => m.pattern.test(path)) ?? null;
}

/**
 * Dependency names from a package.json, across every dependency section,
 * mapped to their declared specifier so an exact pin can be checked directly.
 */
export function parsePackageJson(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return new Map();
  }
  const deps = new Map();
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, spec] of Object.entries(doc?.[field] ?? {})) deps.set(name, String(spec ?? ""));
  }
  return deps;
}

/**
 * Dependency names from a requirements.txt.
 *
 * Deliberately ignores lines that are not a plain requirement: -r includes,
 * flags, URLs, editable installs and environment markers. Guessing at those
 * would produce package names that do not exist and noisy "not found" rows.
 */
export function parseRequirements(text) {
  const deps = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0].trim();
    if (!line || line.startsWith("-") || line.includes("://")) continue;
    // Strip environment markers and extras, keeping the version specifier.
    const bare = line.split(";")[0].trim();
    const name = bare.split("[")[0].split(/[=<>!~ ]/)[0].trim();
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
    const spec = bare.slice(bare.indexOf(name) + name.length).replace(/^\]?/, "").trim();
    deps.set(name, spec);
  }
  return deps;
}

/**
 * Crate names from a Cargo.toml.
 *
 * A deliberately small TOML reader rather than a dependency: it only needs the
 * dependency tables, and pulling a TOML parser into an action would mean
 * vendoring node_modules that every consumer would have to trust.
 */
export function parseCargoToml(text) {
  const names = new Map();
  let inDeps = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      // [dependencies], [dev-dependencies], [build-dependencies] and their
      // target-specific forms, but not [dependencies.foo] which names one crate
      // whose key we would otherwise miss — handled below.
      const section = line.replace(/^\[+|\]+$/g, "");
      const parts = section.split(".");
      const last = parts[parts.length - 1];
      const isDepTable = /^(dev-|build-)?dependencies$/.test(last);
      const isSingleDep = parts.length >= 2 && /^(dev-|build-)?dependencies$/.test(parts[parts.length - 2]);
      inDeps = isDepTable;
      if (isSingleDep) names.set(last, "");
      continue;
    }
    if (!inDeps || !line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const name = line.slice(0, eq).trim().replace(/^["']|["']$/g, "");
    const spec = line.slice(eq + 1).trim().replace(/^["']|["'],?$/g, "");
    if (/^[A-Za-z0-9._-]+$/.test(name)) names.set(name, spec);
  }
  return names;
}

/** Names present in head but not in base — the dependencies this PR introduces. */
export function addedDependencies(baseText, headText, parse) {
  const before = baseText ? parse(baseText) : new Map();
  const after = parse(headText);
  return [...after.entries()]
    .filter(([name]) => !before.has(name))
    .map(([name, spec]) => ({ name, spec }));
}

/**
 * The exact version a specifier pins, or null when it declares a range.
 *
 * Pinned versions are where advisories actually bite: a range resolves to
 * whatever is current, but `pyyaml==5.3.1` installs a known-vulnerable release
 * forever. Checking the pin rather than the latest release is the difference
 * between catching that and reporting the package as clean.
 *
 * Anything ambiguous returns null and falls back to the current release, which
 * is the safer error: a range reported against latest is approximate, whereas
 * guessing a version out of a range would be wrong.
 */
export function pinnedVersion(spec, ecosystem) {
  const s = String(spec ?? "").trim();
  if (!s) return null;
  if (ecosystem === "pypi") {
    const m = s.match(/^==\s*([0-9][^,;\s]*)$/);
    return m ? m[1] : null;
  }
  if (ecosystem === "crates") {
    const m = s.match(/^=\s*([0-9][^,\s]*)$/);
    return m ? m[1] : null;
  }
  // npm: a bare semver with no range operator is an exact pin.
  return /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(s) ? s : null;
}

const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MODERATE: 2, MEDIUM: 2, LOW: 1 };

export function severityRank(severity) {
  return SEVERITY_RANK[String(severity ?? "").toUpperCase()] ?? 0;
}

export function highestSeverity(vulns) {
  let worst = null;
  let rank = 0;
  for (const v of vulns ?? []) {
    const r = severityRank(v.severity);
    if (r > rank) {
      rank = r;
      worst = String(v.severity).toUpperCase();
    }
  }
  return worst;
}

/**
 * Whether a set of findings should fail the check.
 *
 * `failOn` is a floor, not a filter: "high" fails on high and critical. A
 * package that could not be looked up never fails the build — an upstream
 * outage must not block someone else's PR.
 */
export function shouldFail(findings, failOn) {
  const threshold = severityRank(failOn === "critical" ? "CRITICAL" : failOn === "high" ? "HIGH" : failOn === "moderate" ? "MODERATE" : failOn === "low" ? "LOW" : null);
  if (!threshold) return false;
  return findings.some(
    (f) => f.found && f.vulns?.length && severityRank(highestSeverity(f.vulns)) >= threshold,
  );
}

/** Deprecated, unmaintained, or vulnerable — the things worth surfacing. */
export function concerns(finding) {
  const out = [];
  if (!finding.found) return out;
  if (finding.deprecated) out.push("deprecated");
  const worst = highestSeverity(finding.vulns);
  if (worst) out.push(`${finding.vulns.length} advisor${finding.vulns.length === 1 ? "y" : "ies"} (max ${worst})`);
  if (finding.lastPublish) {
    const years = (Date.now() - new Date(finding.lastPublish).getTime()) / (1000 * 60 * 60 * 24 * 365);
    if (years >= 2) out.push(`no release in ${Math.floor(years)}y`);
  }
  if (finding.license === null) out.push("no license declared");
  return out;
}
