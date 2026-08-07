/**
 * Rate limiting for the free tier.
 *
 * Free routes hit npm / PyPI / OSV / deps.dev on a cache miss, and those
 * sources have no auth and no contract with us — a runaway agent loop is how we
 * get our egress IP blocked. Paid routes are deliberately not limited: their
 * price is the limiter.
 *
 * Deliberately runtime-agnostic (no node: imports). This module is reachable
 * from both the Node entrypoint and the Workers one.
 */

export interface RateLimitConfig {
  perMinute: number;
  perDay: number;
  /** Cap on tracked keys, so a spray of source addresses cannot grow the map without bound. */
  maxKeys: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  perMinute: 60,
  perDay: 2000,
  maxKeys: 10_000,
};

export interface RateLimitResult {
  allowed: boolean;
  /** Which window rejected the request, for the error message. */
  window: "minute" | "day" | null;
  retryAfterSeconds: number;
}

interface Counter {
  minuteStart: number;
  minuteCount: number;
  dayStart: number;
  dayCount: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Fixed-window counters rather than a rolling log: two integers per key instead
 * of a timestamp array, which matters when the point is to bound memory under
 * exactly the abusive traffic the limiter exists to stop. The tradeoff is that
 * a caller can send up to 2x the limit across a window boundary; harmless here,
 * where the goal is protecting upstreams from sustained load, not exact quota.
 */
export class RateLimiter {
  private readonly counters = new Map<string, Counter>();

  constructor(private readonly config: RateLimitConfig = DEFAULT_RATE_LIMIT) {}

  /** Number of keys currently tracked. Exposed for tests and /healthz. */
  get size(): number {
    return this.counters.size;
  }

  check(key: string, now: number = Date.now()): RateLimitResult {
    const counter = this.touch(key, now);

    if (now - counter.minuteStart >= MINUTE_MS) {
      counter.minuteStart = now;
      counter.minuteCount = 0;
    }
    if (now - counter.dayStart >= DAY_MS) {
      counter.dayStart = now;
      counter.dayCount = 0;
    }

    if (counter.minuteCount >= this.config.perMinute) {
      return {
        allowed: false,
        window: "minute",
        retryAfterSeconds: secondsUntil(counter.minuteStart + MINUTE_MS, now),
      };
    }
    if (counter.dayCount >= this.config.perDay) {
      return {
        allowed: false,
        window: "day",
        retryAfterSeconds: secondsUntil(counter.dayStart + DAY_MS, now),
      };
    }

    counter.minuteCount += 1;
    counter.dayCount += 1;
    return { allowed: true, window: null, retryAfterSeconds: 0 };
  }

  /**
   * Fetches a counter and marks it most-recently-used. Map iterates in
   * insertion order, so re-inserting on access makes the first key the least
   * recently used one — evicting that is the closest thing to an LRU we need.
   */
  private touch(key: string, now: number): Counter {
    const existing = this.counters.get(key);
    if (existing) {
      this.counters.delete(key);
      this.counters.set(key, existing);
      return existing;
    }

    if (this.counters.size >= this.config.maxKeys) {
      const oldest = this.counters.keys().next();
      if (!oldest.done) this.counters.delete(oldest.value);
    }

    const fresh: Counter = { minuteStart: now, minuteCount: 0, dayStart: now, dayCount: 0 };
    this.counters.set(key, fresh);
    return fresh;
  }
}

function secondsUntil(deadline: number, now: number): number {
  return Math.max(1, Math.ceil((deadline - now) / 1000));
}

/** Bucket for callers whose real address we cannot establish. */
export const SHARED_BUCKET_KEY = "untrusted";

/**
 * Works out what to count a request against.
 *
 * The client's address only reaches us as a header, and headers are
 * client-settable — a caller who forges a fresh one per request would get
 * unlimited free upstream fan-out, and the tunnel hostname is directly
 * reachable, so they need not go through our proxy at all. The proxy therefore
 * signs its forwarded address with a shared secret, and an unsigned address is
 * not trusted: those requests all share one bucket instead.
 *
 * With no secret configured (local development) the header is taken at face
 * value, which is why the server warns at startup if it is missing on mainnet.
 */
export function resolveRateLimitKey(
  headers: { get(name: string): string | null },
  proxySecret?: string,
): string {
  const forwarded = headers.get("x-stable-ip");
  if (!forwarded) return SHARED_BUCKET_KEY;
  if (!proxySecret) return forwarded;
  return headers.get("x-proxy-secret") === proxySecret ? forwarded : SHARED_BUCKET_KEY;
}
