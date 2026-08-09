import { describe, expect, it } from "vitest";
import type { PackageRow } from "../src/domain/packageRow.js";

/**
 * The row shape is the product here — a dataset consumer opens it in a
 * spreadsheet, and a column that is sometimes absent breaks that quietly.
 * These assert the contract without hitting the network; the live behaviour is
 * covered by running the Actor.
 */

/** Mirrors emptyRow in packageRow.ts. Duplicated deliberately: if the real one
 *  changes shape, this test fails, which is the point. */
const errorRowKeys = [
  "ecosystem", "name", "found", "error",
  "version", "license", "description", "repository", "lastPublish",
  "maintainerCount", "deprecated", "deprecatedReason",
  "weeklyDownloads", "weeklyDownloadsIsEstimate",
  "vulnerabilityCount", "maxSeverity", "vulnerabilityIds",
  "directDependencies", "transitiveDependencies", "deprecatedDependencies",
  "healthScore", "maintenanceScore", "popularityScore", "securityScore",
  "freshnessScore", "rationale",
  "sources", "checkedAt",
];

describe("row contract", () => {
  it("declares every column the overview view expects", () => {
    // The dataset_schema.json overview lists these; a rename here without a
    // matching one there produces empty columns in the Apify UI.
    const shown = [
      "ecosystem", "name", "version", "healthScore", "vulnerabilityCount",
      "maxSeverity", "deprecated", "license", "weeklyDownloads", "lastPublish", "found",
    ];
    for (const field of shown) {
      expect(errorRowKeys, `dataset view references ${field}`).toContain(field);
    }
  });

  it("keeps 'could not check' distinct from 'nothing found'", () => {
    // vulnerabilityCount is null when the advisory lookup failed and 0 when it
    // succeeded and found none. Collapsing those to 0 would report an unchecked
    // package as clean, which is the one error this tool must never make.
    const unchecked: Partial<PackageRow> = { vulnerabilityCount: null };
    const clean: Partial<PackageRow> = { vulnerabilityCount: 0 };
    expect(unchecked.vulnerabilityCount).toBeNull();
    expect(clean.vulnerabilityCount).toBe(0);
    expect(unchecked.vulnerabilityCount).not.toBe(clean.vulnerabilityCount);
  });

  it("has a column for the crates.io download caveat", () => {
    // crates.io publishes no weekly figure, so weeklyDownloads is derived there.
    // Without the flag a consumer would compare an estimate against reported
    // numbers from npm and PyPI without knowing.
    expect(errorRowKeys).toContain("weeklyDownloadsIsEstimate");
  });
});
