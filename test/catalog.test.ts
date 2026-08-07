import { describe, expect, it } from "vitest";
import {
  CATALOG,
  freeRouteSegments,
  isPaid,
  paidEntries,
} from "../src/catalog.js";

/**
 * The tier split decides what the payment middleware charges for. Getting it
 * wrong is either "we gave away the only thing we sell" or "we charge for
 * something we advertise as free" — both silent, so they are asserted here
 * rather than left to be noticed in production.
 */
describe("catalog tiers", () => {
  it("charges for exactly the consolidated-score routes", () => {
    expect(paidEntries().map((e) => e.route).sort()).toEqual([
      "GET /v1/health/:ecosystem/:name",
      "POST /v1/batch",
    ]);
  });

  it("gives away exactly the raw-passthrough routes", () => {
    const free = CATALOG.filter((e) => !isPaid(e)).map((e) => e.route).sort();
    expect(free).toEqual([
      "GET /v1/deps/:ecosystem/:name",
      "GET /v1/downloads/:ecosystem/:name",
      "GET /v1/package/:ecosystem/:name",
      "GET /v1/vulns/:ecosystem/:name",
    ]);
  });

  it("gives every paid entry a price and no free entry one", () => {
    for (const entry of CATALOG) {
      if (isPaid(entry)) {
        expect(entry.price, `${entry.route} is paid but has no price`).toMatch(/^\$\d/);
      } else {
        expect(entry, `${entry.route} is free but carries a price`).not.toHaveProperty("price");
      }
    }
  });

  it("covers every route in exactly one tier", () => {
    const freeCount = CATALOG.length - paidEntries().length;
    expect(freeCount + paidEntries().length).toBe(CATALOG.length);
    expect(CATALOG.every((e) => e.tier === "free" || e.tier === "paid")).toBe(true);
  });
});

describe("freeRouteSegments", () => {
  it("derives the segments the rate limiter matches on", () => {
    expect([...freeRouteSegments()].sort()).toEqual(["deps", "downloads", "package", "vulns"]);
  });

  it("never includes a paid route, which would meter a route that costs money", () => {
    const segments = freeRouteSegments();
    for (const entry of paidEntries()) {
      const segment = entry.route.split(" ")[1]?.split("/")[2];
      expect(segments.has(segment ?? ""), `${entry.route} is paid but marked rate-limitable`).toBe(
        false,
      );
    }
  });

  it("produces a usable segment for every free route", () => {
    for (const segment of freeRouteSegments()) {
      expect(segment).not.toBe("");
      expect(segment).not.toContain(":");
    }
  });
});
