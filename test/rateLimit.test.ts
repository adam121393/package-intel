import { describe, expect, it } from "vitest";
import { RateLimiter, resolveRateLimitKey, SHARED_BUCKET_KEY } from "../src/rateLimit.js";

const MINUTE = 60_000;
const DAY = 86_400_000;

/** Time is injected rather than mocked globally, so these stay fast and deterministic. */
function limiter(overrides: Partial<{ perMinute: number; perDay: number; maxKeys: number }> = {}) {
  return new RateLimiter({ perMinute: 3, perDay: 10, maxKeys: 4, ...overrides });
}

describe("RateLimiter", () => {
  it("allows up to the per-minute limit and rejects the next request", () => {
    const rl = limiter();
    const now = 1_000_000;

    for (let i = 0; i < 3; i++) {
      expect(rl.check("a", now).allowed, `request ${i + 1} should be allowed`).toBe(true);
    }

    const rejected = rl.check("a", now);
    expect(rejected.allowed).toBe(false);
    expect(rejected.window).toBe("minute");
    expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("refills once the minute window rolls over", () => {
    const rl = limiter();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) rl.check("a", now);

    expect(rl.check("a", now).allowed).toBe(false);
    expect(rl.check("a", now + MINUTE).allowed).toBe(true);
  });

  it("enforces the daily cap independently of the minute cap", () => {
    const rl = limiter({ perMinute: 100, perDay: 5 });
    let now = 1_000_000;

    for (let i = 0; i < 5; i++) {
      expect(rl.check("a", now).allowed).toBe(true);
      now += MINUTE; // step past the minute window each time, so only the day cap can bite
    }

    const rejected = rl.check("a", now);
    expect(rejected.allowed).toBe(false);
    expect(rejected.window).toBe("day");
  });

  it("resets the daily counter after a day", () => {
    const rl = limiter({ perMinute: 100, perDay: 2 });
    const now = 1_000_000;
    rl.check("a", now);
    rl.check("a", now);

    expect(rl.check("a", now).allowed).toBe(false);
    expect(rl.check("a", now + DAY).allowed).toBe(true);
  });

  it("keeps callers isolated from each other", () => {
    const rl = limiter();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) rl.check("a", now);

    expect(rl.check("a", now).allowed).toBe(false);
    expect(rl.check("b", now).allowed).toBe(true);
  });

  it("evicts the least recently used key instead of growing without bound", () => {
    const rl = limiter({ maxKeys: 2 });
    const now = 1_000_000;

    rl.check("a", now);
    rl.check("b", now);
    rl.check("a", now); // 'a' becomes most-recently-used, so 'b' is next out
    rl.check("c", now);

    expect(rl.size).toBe(2);
    // 'b' was evicted, so its counter starts fresh and it gets a full allowance.
    for (let i = 0; i < 3; i++) expect(rl.check("b", now).allowed).toBe(true);
  });

  it("never lets the tracked-key count exceed the cap under a spray of addresses", () => {
    const rl = limiter({ maxKeys: 4 });
    for (let i = 0; i < 500; i++) rl.check(`ip-${i}`, 1_000_000);
    expect(rl.size).toBe(4);
  });
});

describe("resolveRateLimitKey", () => {
  const headers = (values: Record<string, string>) => ({
    get: (name: string) => values[name] ?? null,
  });

  it("uses the forwarded address when the proxy secret matches", () => {
    const key = resolveRateLimitKey(
      headers({ "x-stable-ip": "1.2.3.4", "x-proxy-secret": "s3cret" }),
      "s3cret",
    );
    expect(key).toBe("1.2.3.4");
  });

  it("refuses a forwarded address carrying the wrong secret", () => {
    const key = resolveRateLimitKey(
      headers({ "x-stable-ip": "1.2.3.4", "x-proxy-secret": "wrong" }),
      "s3cret",
    );
    expect(key).toBe(SHARED_BUCKET_KEY);
  });

  it("refuses a forwarded address with no secret at all — the forgery case", () => {
    const key = resolveRateLimitKey(headers({ "x-stable-ip": "1.2.3.4" }), "s3cret");
    expect(key).toBe(SHARED_BUCKET_KEY);
  });

  it("buckets direct traffic together, so bypassing the proxy is not a bypass", () => {
    expect(resolveRateLimitKey(headers({}), "s3cret")).toBe(SHARED_BUCKET_KEY);
  });

  it("trusts the header when no secret is configured, for local development", () => {
    expect(resolveRateLimitKey(headers({ "x-stable-ip": "1.2.3.4" }), undefined)).toBe("1.2.3.4");
  });

  it("gives forged addresses one shared allowance rather than one each", () => {
    const rl = limiter();
    const now = 1_000_000;
    // Four requests, each forging a different address, none carrying the secret.
    const keys = ["9.9.9.1", "9.9.9.2", "9.9.9.3", "9.9.9.4"].map((ip) =>
      resolveRateLimitKey(headers({ "x-stable-ip": ip }), "s3cret"),
    );

    const verdicts = keys.map((k) => rl.check(k, now).allowed);
    expect(verdicts).toEqual([true, true, true, false]);
  });
});
