import { describe, expect, it } from "vitest";
import { describeRequest, readStats, recordCall } from "../src/callLog.js";

describe("request classification", () => {
  it("splits a path-param route into route, ecosystem and package", () => {
    expect(describeRequest("/v1/health/npm/express")).toEqual({
      route: "/v1/health",
      ecosystem: "npm",
      packageName: "express",
    });
    expect(describeRequest("/v1/package/crates/serde")).toEqual({
      route: "/v1/package",
      ecosystem: "crates",
      packageName: "serde",
    });
  });

  it("keeps scoped npm names whole", () => {
    // "@types/node" arrives as two path segments; joining only the first would
    // record every scoped package as its scope.
    expect(describeRequest("/v1/vulns/npm/@types/node")).toEqual({
      route: "/v1/vulns",
      ecosystem: "npm",
      packageName: "@types/node",
    });
  });

  it("treats batch as a route with no single package", () => {
    expect(describeRequest("/v1/batch")).toEqual({
      route: "/v1/batch",
      ecosystem: null,
      packageName: null,
    });
  });

  it("passes non-v1 paths through without inventing fields", () => {
    expect(describeRequest("/healthz")).toEqual({
      route: "/healthz",
      ecosystem: null,
      packageName: null,
    });
  });
});

describe("log writes are best-effort", () => {
  it("never rejects when the database throws", async () => {
    // Analytics must not be able to fail a working API call.
    const broken = {
      prepare: () => ({
        bind: () => ({
          run: () => Promise.reject(new Error("D1 unavailable")),
          all: () => Promise.reject(new Error("D1 unavailable")),
        }),
        all: () => Promise.reject(new Error("D1 unavailable")),
      }),
    };
    await expect(
      recordCall(broken, {
        route: "/v1/vulns",
        ecosystem: "npm",
        packageName: "express",
        tier: "free",
        status: 200,
        servedBy: "edge",
        durationMs: 12,
        country: "CA",
        userAgent: "probe",
        paid: false,
      }),
    ).resolves.toBeUndefined();
  });

  it("is a no-op when no database is bound", async () => {
    await expect(
      recordCall(undefined, {
        route: "/v1/vulns",
        ecosystem: "npm",
        packageName: "express",
        tier: "free",
        status: 200,
        servedBy: "edge",
        durationMs: 1,
        country: null,
        userAgent: null,
        paid: false,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("stats aggregation", () => {
  it("reports zeroes rather than nulls on an empty log", async () => {
    // A brand-new database returns SUM(...) as null; surfacing that as
    // "paidCalls: null" would read as broken rather than as "nothing yet".
    const empty = {
      prepare: () => ({
        bind: () => ({
          run: () => Promise.resolve({}),
          all: () =>
            Promise.resolve({
              results: [
                { calls: 0, paidCalls: null, free: null, errors: null, unpaidChallenges: null, firstTs: null },
              ],
            }),
        }),
        all: () => Promise.resolve({ results: [] }),
      }),
    };
    const stats = await readStats(empty);
    expect(stats.totals).toEqual({
      calls: 0,
      paidCalls: 0,
      free: 0,
      errors: 0,
      unpaidChallenges: 0,
    });
    expect(stats.since).toBeNull();
  });
});
