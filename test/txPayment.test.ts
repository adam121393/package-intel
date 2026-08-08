import { describe, expect, it } from "vitest";
import { matchPaidRoute, priceToAtomicUsdc } from "../src/payment/txGate.js";
import { isTxHashShape } from "../src/payment/txVerify.js";
import { MemoryUsedTxStore } from "../src/payment/usedTx.js";

/**
 * Everything here guards the same failure: serving a paid response without
 * having been paid, or charging twice for one payment. None of it surfaces as
 * an exception in production — it surfaces as missing money.
 */

describe("price conversion", () => {
  it("converts dollar prices to USDC atomic units", () => {
    // USDC has 6 decimals. Done as string arithmetic because 0.01 has no exact
    // binary float representation — 0.01 * 1e6 is 10000.000000000002.
    expect(priceToAtomicUsdc("$0.01")).toBe(10_000n);
    expect(priceToAtomicUsdc("$0.02")).toBe(20_000n);
    expect(priceToAtomicUsdc("$1")).toBe(1_000_000n);
    expect(priceToAtomicUsdc("$1.5")).toBe(1_500_000n);
    expect(priceToAtomicUsdc("$0.000001")).toBe(1n);
  });

  it("does not round a sub-unit price up into a charge", () => {
    expect(priceToAtomicUsdc("$0.0000001")).toBe(0n);
  });

  it("matches the amount advertised in the live 402 challenge", () => {
    // The deployed challenge advertises 10000 for the $0.01 health endpoint.
    // If these ever disagree, callers pay one amount and we check another.
    expect(priceToAtomicUsdc("$0.01").toString()).toBe("10000");
  });
});

describe("tx hash shape", () => {
  it("accepts a 32-byte hex hash", () => {
    expect(isTxHashShape(`0x${"a".repeat(64)}`)).toBe(true);
    expect(isTxHashShape(`0x${"A1b2".repeat(16)}`)).toBe(true);
  });

  it("rejects anything else before it reaches an RPC call", () => {
    for (const bad of [
      "",
      "0x",
      "a".repeat(64), // no 0x
      `0x${"a".repeat(63)}`, // too short
      `0x${"a".repeat(65)}`, // too long
      `0x${"g".repeat(64)}`, // not hex
      "0x' OR 1=1--",
    ]) {
      expect(isTxHashShape(bad), `should reject ${JSON.stringify(bad)}`).toBe(false);
    }
  });
});

describe("paid route matching", () => {
  it("matches the paid routes on the right method", () => {
    expect(matchPaidRoute("GET", "/v1/health/npm/express")?.route).toBe(
      "GET /v1/health/:ecosystem/:name",
    );
    expect(matchPaidRoute("GET", "/v1/health/crates/serde")?.price).toBe("$0.01");
    expect(matchPaidRoute("POST", "/v1/batch")?.price).toBe("$0.02");
  });

  it("does not treat free routes as payable", () => {
    // A false positive here would demand payment for something advertised free.
    for (const path of [
      "/v1/vulns/npm/express",
      "/v1/deps/npm/express",
      "/v1/package/npm/express",
      "/v1/downloads/npm/express",
      "/healthz",
      "/.well-known/x402",
    ]) {
      expect(matchPaidRoute("GET", path), `${path} must not be payable`).toBeNull();
    }
  });

  it("does not match a paid route on the wrong method", () => {
    expect(matchPaidRoute("GET", "/v1/batch")).toBeNull();
    expect(matchPaidRoute("POST", "/v1/health/npm/express")).toBeNull();
  });

  it("does not match extra path segments", () => {
    // ":name" is a single segment; "/v1/health/npm/a/b" must not slip through.
    expect(matchPaidRoute("GET", "/v1/health/npm/express/extra")).toBeNull();
    expect(matchPaidRoute("GET", "/v1/healthz")).toBeNull();
    expect(matchPaidRoute("GET", "/prefix/v1/health/npm/express")).toBeNull();
  });
});

describe("single-use transaction ledger", () => {
  it("allows a hash exactly once", () => {
    const store = new MemoryUsedTxStore();
    const hash = `0x${"1".repeat(64)}`;
    expect(store.claim(hash)).toBe(true);
    expect(store.claim(hash)).toBe(false);
    expect(store.claim(hash)).toBe(false);
  });

  it("treats case variants as the same hash", () => {
    // Otherwise re-sending the same hash upper-cased would buy a second call.
    const store = new MemoryUsedTxStore();
    expect(store.claim(`0x${"a".repeat(64)}`)).toBe(true);
    expect(store.claim(`0x${"A".repeat(64)}`)).toBe(false);
  });

  it("keeps distinct hashes independent", () => {
    const store = new MemoryUsedTxStore();
    expect(store.claim(`0x${"1".repeat(64)}`)).toBe(true);
    expect(store.claim(`0x${"2".repeat(64)}`)).toBe(true);
    expect(store.size()).toBe(2);
  });

  it("claims atomically across concurrent callers", async () => {
    // claim() must not await between checking and inserting, or two requests
    // presenting the same hash could both be served.
    const store = new MemoryUsedTxStore();
    const hash = `0x${"c".repeat(64)}`;
    const results = await Promise.all(
      Array.from({ length: 50 }, async () => store.claim(hash)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
