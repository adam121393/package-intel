import { Actor, log } from "apify";
import { buildPackageRow } from "../../src/domain/packageRow.js";
import { ECOSYSTEMS } from "../../src/sources/registry.js";
import type { Ecosystem } from "../../src/types.js";

/**
 * Apify Actor: bulk package intelligence as a dataset.
 *
 * Deliberately thin. Everything that decides an answer — the upstream clients,
 * the health algorithm, the row shape — lives in src/ and is shared with the
 * HTTP API and the MCP server, so a package cannot score differently depending
 * on which product you bought it through.
 *
 * Shaped as rows rather than tool calls because that is what this audience
 * buys: an Actor run produces a dataset you open in a spreadsheet or push into
 * a pipeline. Bulk is also where consolidating four upstreams actually earns
 * its keep — one run over 500 packages replaces roughly 1,500 API calls the
 * user would otherwise wire up themselves.
 */

interface Input {
  packages?: string[];
  ecosystem?: Ecosystem;
  includeDependencies?: boolean;
  maxConcurrency?: number;
}

/** Accepts "npm:express" or a bare name paired with the default ecosystem. */
function parseTarget(entry: string, fallback: Ecosystem): { ecosystem: Ecosystem; name: string } | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  // Scoped npm names contain no colon before the slash, so a leading
  // "<eco>:" prefix is unambiguous even for "@scope/name".
  const match = trimmed.match(/^([a-z]+):(.+)$/);
  if (match && (ECOSYSTEMS as string[]).includes(match[1]!)) {
    return { ecosystem: match[1] as Ecosystem, name: match[2]!.trim() };
  }
  return { ecosystem: fallback, name: trimmed };
}

await Actor.init();

const input = (await Actor.getInput<Input>()) ?? {};
const fallbackEcosystem: Ecosystem = input.ecosystem ?? "npm";
const includeDependencies = Boolean(input.includeDependencies);
const concurrency = Math.min(Math.max(input.maxConcurrency ?? 5, 1), 10);

const targets = (input.packages ?? [])
  .map((entry) => parseTarget(entry, fallbackEcosystem))
  .filter((t): t is { ecosystem: Ecosystem; name: string } => t !== null);

if (targets.length === 0) {
  log.warning("No packages supplied. Provide a list of names, optionally prefixed with npm:, pypi: or crates:.");
  await Actor.exit();
}

log.info(
  `Checking ${targets.length} package(s) across ${new Set(targets.map((t) => t.ecosystem)).size} ecosystem(s)` +
    `${includeDependencies ? ", including dependency graphs" : ""}`,
);

let scored = 0;
let notFound = 0;

// Bounded concurrency: the upstreams are free and unauthenticated, and hammering
// them would get this Actor's egress blocked for every user of it, not just the
// run that caused it.
for (let i = 0; i < targets.length; i += concurrency) {
  const batch = targets.slice(i, i + concurrency);
  const rows = await Promise.all(
    batch.map((t) => buildPackageRow(t.ecosystem, t.name, { includeDependencies })),
  );

  for (const row of rows) {
    await Actor.pushData(row);
    if (row.found) scored += 1;
    else notFound += 1;
  }

  // Charged per package actually scored, never for one we could not resolve.
  // Billing for a "not found" row would be charging for the absence of an
  // answer, which is the fastest way to lose a user permanently.
  const billable = rows.filter((r) => r.found).length;
  if (billable > 0) {
    await Actor.charge({ eventName: "package-scored", count: billable });
  }

  log.info(`Progress: ${Math.min(i + concurrency, targets.length)}/${targets.length}`);
}

log.info(`Done. ${scored} scored, ${notFound} not found.`);
await Actor.exit();
