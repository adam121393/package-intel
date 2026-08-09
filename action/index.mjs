/**
 * Package Intel dependency review.
 *
 * On a pull request that touches package.json, requirements.txt or Cargo.toml,
 * looks up every newly added dependency and comments with what it found:
 * advisories, deprecation, staleness, licence.
 *
 * Zero dependencies on purpose. An action that people add to their CI should be
 * readable in one sitting, and vendoring node_modules into a repo other teams
 * run in their pipelines is a supply-chain ask this project of all things
 * should not be making.
 *
 * Uses only the free endpoints — no wallet, no API key, no signup.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import {
  addedDependencies,
  concerns,
  highestSeverity,
  manifestFor,
  pinnedVersion,
  shouldFail,
} from "./parse.mjs";

const MARKER = "<!-- package-intel-dependency-review -->";

// `||` rather than `??`: an input explicitly set to an empty string should fall
// back to the default, not disable the setting.
const input = (name, fallback = "") =>
  (process.env[`INPUT_${name.toUpperCase().replace(/[ -]/g, "_")}`] || fallback).trim();

const log = (msg) => process.stdout.write(`${msg}\n`);
const setOutput = (name, value) => {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
};

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  } catch {
    return "";
  }
}

/** Manifest files this PR changed, with the base and head contents of each. */
function changedManifests(baseSha, headSha) {
  const listed = git(["diff", "--name-only", `${baseSha}`, `${headSha}`])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const out = [];
  for (const path of listed) {
    const manifest = manifestFor(path);
    if (!manifest) continue;
    // A file added in this PR has no base version; treat that as empty rather
    // than skipping it, or a brand-new manifest gets no review at all.
    const baseText = git(["show", `${baseSha}:${path}`]) || "";
    let headText = "";
    try {
      headText = readFileSync(path, "utf8");
    } catch {
      continue; // Deleted in this PR — nothing added to review.
    }
    out.push({ path, manifest, baseText, headText });
  }
  return out;
}

async function lookup(apiUrl, ecosystem, name, spec) {
  const base = { ecosystem, name, found: false };
  const url = (p) => `${apiUrl}${p}/${ecosystem}/${encodeURIComponent(name)}`;
  try {
    // The snapshot resolves first because advisories must be scoped to a
    // version. Querying without one returns every advisory ever filed against
    // the package, so a fully patched lodash reports as CRITICAL — an action
    // that flags every popular package gets removed from the workflow.
    const snapRes = await fetch(url("/v1/package"), { headers: { accept: "application/json" } });
    if (snapRes.status === 429) return { ...base, error: "rate limited" };
    if (!snapRes.ok) return { ...base, error: `not found (${snapRes.status})` };
    const snap = await snapRes.json();

    // An exact pin is checked as written; a range is reported against the
    // current release, since resolving a range properly would mean shipping a
    // semver implementation for each of three ecosystems.
    const pinned = pinnedVersion(spec, ecosystem);
    const checkedVersion = pinned ?? snap.version ?? null;
    const versionQuery = checkedVersion ? `?version=${encodeURIComponent(checkedVersion)}` : "";
    const vulnRes = await fetch(`${url("/v1/vulns")}${versionQuery}`, {
      headers: { accept: "application/json" },
    });
    if (vulnRes.status === 429) return { ...base, error: "rate limited" };
    const vulns = vulnRes.ok ? ((await vulnRes.json()).vulns ?? []) : [];
    return {
      ecosystem,
      name,
      found: true,
      version: snap.version ?? null,
      checkedVersion,
      pinned: Boolean(pinned),
      license: snap.license ?? null,
      deprecated: Boolean(snap.deprecated),
      lastPublish: snap.lastPublish ?? null,
      weeklyDownloads: snap.weeklyDownloads ?? null,
      vulns,
    };
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Bounded concurrency: the free tier is rate limited and we are a good citizen. */
async function lookupAll(apiUrl, targets, concurrency = 4) {
  const results = [];
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    results.push(
      ...(await Promise.all(batch.map((t) => lookup(apiUrl, t.ecosystem, t.name, t.spec)))),
    );
  }
  return results;
}

function renderComment(findings, failOn, failed) {
  const lines = [MARKER, "## Dependency review", ""];

  if (findings.length === 0) {
    lines.push("No new dependencies in this pull request.");
    return lines.join("\n");
  }

  const flagged = findings.filter((f) => concerns(f).length > 0);
  const clean = findings.filter((f) => f.found && concerns(f).length === 0);
  const unknown = findings.filter((f) => !f.found);

  lines.push(
    `Checked **${findings.length}** newly added ${findings.length === 1 ? "dependency" : "dependencies"}.`,
    "",
  );

  if (flagged.length) {
    lines.push("### Worth a look", "", "| Package | Version | Findings |", "|---|---|---|");
    for (const f of flagged) {
      const shown = f.checkedVersion ?? f.version ?? "?";
      lines.push(
        `| \`${f.ecosystem}:${f.name}\` | ${shown}${f.pinned ? " (pinned)" : ""} | ${concerns(f).join(", ")} |`,
      );
    }
    lines.push("");
    for (const f of flagged.filter((x) => x.vulns?.length)) {
      lines.push(`<details><summary>Advisories for <code>${f.name}</code></summary>`, "");
      for (const v of f.vulns.slice(0, 10)) {
        lines.push(`- **${v.id}** (${v.severity ?? "unrated"}) — ${v.summary ?? "no summary"}`);
      }
      if (f.vulns.length > 10) lines.push(`- …and ${f.vulns.length - 10} more`);
      lines.push("", "</details>", "");
    }
  }

  if (clean.length) {
    lines.push(
      `### No concerns (${clean.length})`,
      "",
      clean.map((f) => `\`${f.name}\``).join(", "),
      "",
    );
  }

  if (unknown.length) {
    // Never presented as a failure: an upstream outage or a private package
    // must not read as a problem with someone's PR.
    lines.push(
      `### Not checked (${unknown.length})`,
      "",
      unknown.map((f) => `\`${f.name}\` — ${f.error ?? "not found"}`).join("<br>"),
      "",
    );
  }

  if (failed) {
    lines.push(
      `> **This check failed** because a dependency has an advisory at or above \`${failOn}\`.`,
      "",
    );
  }

  lines.push(
    "",
    "<sub>Exactly pinned versions are checked as written; a range is checked against the package's current release, since a manifest declares a range rather than a resolved version. Data from the npm registry, PyPI, crates.io, [OSV.dev](https://osv.dev) and [deps.dev](https://deps.dev), via [Package Intel](https://github.com/adam121393/package-intel). Free, no API key.</sub>",
  );
  return lines.join("\n");
}

async function upsertComment(token, repo, prNumber, body) {
  const api = "https://api.github.com";
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "user-agent": "package-intel-action",
  };

  // Update our own previous comment rather than adding one per push, which
  // turns a busy PR into a wall of bot noise.
  const existing = await fetch(`${api}/repos/${repo}/issues/${prNumber}/comments?per_page=100`, {
    headers,
  })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const mine = Array.isArray(existing) ? existing.find((c) => c.body?.includes(MARKER)) : null;

  const res = mine
    ? await fetch(`${api}/repos/${repo}/issues/comments/${mine.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ body }),
      })
    : await fetch(`${api}/repos/${repo}/issues/${prNumber}/comments`, {
        method: "POST",
        headers,
        body: JSON.stringify({ body }),
      });

  if (!res.ok) {
    log(`::warning::Could not post the review comment (HTTP ${res.status}). Results are in the log below.`);
    return false;
  }
  return true;
}

async function main() {
  const apiUrl = (input("api-url", "https://marketagent.adam121393.workers.dev")).replace(/\/$/, "");
  const failOn = input("fail-on", "none").toLowerCase();
  const token = input("github-token");
  const comment = input("comment", "true") !== "false";

  const eventPath = process.env.GITHUB_EVENT_PATH;
  const event = eventPath ? JSON.parse(readFileSync(eventPath, "utf8")) : {};
  const pr = event.pull_request;
  if (!pr) {
    log("::notice::Not a pull request event — nothing to review.");
    return;
  }

  const baseSha = pr.base?.sha;
  const headSha = pr.head?.sha ?? process.env.GITHUB_SHA;
  if (!baseSha) {
    log("::warning::No base commit on the event payload; cannot determine what changed.");
    return;
  }

  const manifests = changedManifests(baseSha, headSha);
  if (manifests.length === 0) {
    log("No dependency manifests changed in this pull request.");
    setOutput("checked", "0");
    setOutput("flagged", "0");
    return;
  }

  const targets = [];
  for (const { path, manifest, baseText, headText } of manifests) {
    const added = addedDependencies(baseText, headText, manifest.parse);
    log(`${path}: ${added.length} added ${added.length === 1 ? "dependency" : "dependencies"}`);
    for (const { name, spec } of added) targets.push({ ecosystem: manifest.ecosystem, name, spec });
  }

  // De-duplicate: the same package can appear in several manifests.
  const seen = new Set();
  const unique = targets.filter((t) => {
    const key = `${t.ecosystem}:${t.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const findings = await lookupAll(apiUrl, unique);
  const failed = shouldFail(findings, failOn);

  for (const f of findings) {
    const c = concerns(f);
    log(`  ${f.ecosystem}:${f.name} — ${f.found ? (c.length ? c.join(", ") : "no concerns") : (f.error ?? "not found")}`);
  }

  setOutput("checked", String(findings.length));
  setOutput("flagged", String(findings.filter((f) => concerns(f).length > 0).length));

  if (comment && token) {
    await upsertComment(token, process.env.GITHUB_REPOSITORY, pr.number, renderComment(findings, failOn, failed));
  } else if (comment && !token) {
    log("::warning::No github-token supplied, so no comment was posted.");
  }

  if (failed) {
    // Only the packages that actually crossed the threshold. Listing every
    // package with any advisory would name ones that did not cause the
    // failure, and send people chasing the wrong dependency.
    const culprits = findings
      .filter((f) => f.found && f.vulns?.length && shouldFail([f], failOn))
      .map((f) => `${f.name}@${f.checkedVersion ?? "?"} (${highestSeverity(f.vulns)})`)
      .join(", ");
    log(`::error::Dependency review failed at threshold '${failOn}': ${culprits}`);
    process.exitCode = 1;
  }
}

await main();
