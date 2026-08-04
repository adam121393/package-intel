import { LRUCache } from "lru-cache";

// noDeleteOnStaleGet is required for the fail-open path below: without it,
// lru-cache deletes an entry the moment its TTL expires and any `get()`
// touches it (even a plain `store.get(key)`), so by the time the fetch fails
// and we go looking for a stale fallback, nothing would be left to find.
const store = new LRUCache<string, object>({ max: 20_000, noDeleteOnStaleGet: true });

export class UpstreamNotFoundError extends Error {}

/**
 * Cache-or-fetch with fail-open: on upstream failure, serve a stale cached
 * value (flagged `stale: true`) rather than erroring, if one exists.
 * Throws UpstreamNotFoundError untouched (not-found is not cached, not stale-served).
 */
export async function cached<T extends object>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T & { stale?: true }> {
  const hit = store.get(key) as T | undefined;
  if (hit !== undefined) return hit;

  try {
    const value = await fn();
    store.set(key, value, { ttl: ttlMs });
    return value;
  } catch (err) {
    if (err instanceof UpstreamNotFoundError) throw err;
    const stale = store.get(key, { allowStale: true }) as T | undefined;
    if (stale !== undefined) return { ...stale, stale: true };
    throw err;
  }
}
