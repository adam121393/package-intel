import { describe, expect, it } from "vitest";
import { PATH_PARAMS_SCHEMA } from "../src/catalog.js";
import { ecosystemList, parseEcosystem } from "../src/routes/helpers.js";
import { estimateWeeklyFromRecent } from "../src/sources/cratesIo.js";
import {
  ECOSYSTEM_LABEL,
  ECOSYSTEMS,
  getDownloads,
  getSnapshot,
  REGISTRY_ATTRIBUTION,
} from "../src/sources/registry.js";
import type { Ecosystem } from "../src/types.js";

/**
 * Adding an ecosystem touches a dispatch record, a validator, a zod enum and a
 * JSON schema. The type system catches the first; these cover the rest, because
 * the failure mode is not a crash — it is serving PyPI data for a crate, or
 * rejecting a request the handlers would have answered.
 */
describe("ecosystem wiring", () => {
  it("dispatches every ecosystem to a distinct implementation", () => {
    // A Record<Ecosystem, fn> cannot be under-populated, but it *can* be
    // populated twice with the same function — which is exactly the bug the
    // old `ecosystem === "npm" ? npm : pypi` ternaries had.
    const fns = ECOSYSTEMS.map((e) => getSnapshot[e]);
    expect(new Set(fns).size).toBe(ECOSYSTEMS.length);

    const dl = ECOSYSTEMS.map((e) => getDownloads[e]);
    expect(new Set(dl).size).toBe(ECOSYSTEMS.length);
  });

  it("has an attribution and a label for every ecosystem", () => {
    for (const e of ECOSYSTEMS) {
      expect(REGISTRY_ATTRIBUTION[e], `attribution for ${e}`).toBeTruthy();
      expect(ECOSYSTEM_LABEL[e], `label for ${e}`).toBeTruthy();
    }
    expect(new Set(Object.values(REGISTRY_ATTRIBUTION)).size).toBe(ECOSYSTEMS.length);
  });

  it("accepts every supported ecosystem and nothing else", () => {
    for (const e of ECOSYSTEMS) expect(parseEcosystem(e)).toBe(e);
    for (const bad of ["", "CRATES", "cargo", "crates.io", "go", "../etc", "npm "]) {
      expect(parseEcosystem(bad), `should reject ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it("supports crates specifically", () => {
    // Named explicitly so removing crates from the union is a test failure,
    // not a silently smaller ECOSYSTEMS array that every other test still passes.
    expect(ECOSYSTEMS).toContain("crates" satisfies Ecosystem);
    expect(parseEcosystem("crates")).toBe("crates");
  });

  it("advertises the same ecosystem list to indexers that it accepts", () => {
    // A schema narrower than the validator makes Bazaar probe with an input the
    // service rejects; wider, and it advertises what it cannot serve.
    expect([...(PATH_PARAMS_SCHEMA.properties.ecosystem.enum as string[])].sort()).toEqual(
      [...ECOSYSTEMS].sort(),
    );
  });

  it("names every ecosystem in the 400 message", () => {
    const message = ecosystemList();
    for (const e of ECOSYSTEMS) expect(message).toContain(e);
  });
});

describe("crates.io download normalisation", () => {
  it("converts a 90-day total to a weekly rate", () => {
    // The popularity subscore is a log curve calibrated on weekly counts, so a
    // raw 90-day total would overstate every crate by roughly an order of
    // magnitude. 90 downloads over 90 days is 7 per week.
    expect(estimateWeeklyFromRecent(90)).toBe(7);
    expect(estimateWeeklyFromRecent(0)).toBe(0);
  });

  it("scales a real figure into the right magnitude", () => {
    // serde: ~263M over 90 days is ~20M/week, not ~263M/week.
    const weekly = estimateWeeklyFromRecent(263_178_049);
    expect(weekly).toBeGreaterThan(19_000_000);
    expect(weekly).toBeLessThan(22_000_000);
  });
});
