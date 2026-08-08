import type { Context } from "hono";
import { UpstreamNotFoundError } from "../cache.js";
import { ECOSYSTEMS } from "../sources/registry.js";
import type { Ecosystem } from "../types.js";

/**
 * Derived from the dispatch record rather than a hand-written literal union, so
 * a newly supported ecosystem is accepted here the moment it has an
 * implementation — and cannot be accepted before it has one.
 */
export function parseEcosystem(value: string): Ecosystem | null {
  return (ECOSYSTEMS as string[]).includes(value) ? (value as Ecosystem) : null;
}

/** For error messages: `'npm', 'pypi' or 'crates'`. */
export function ecosystemList(): string {
  const quoted = ECOSYSTEMS.map((e) => `'${e}'`);
  return quoted.length <= 1
    ? (quoted[0] ?? "")
    : `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
}

/**
 * Runs a route handler body and maps errors to the right HTTP status.
 * Both 404 (not found) and 502 (upstream unavailable) are >= 400, which the
 * x402 middleware treats as "never settle" — confirmed by reading the
 * compiled @x402/hono middleware. So neither case charges the buyer.
 */
export async function withUpstreamErrors(c: Context, fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UpstreamNotFoundError) {
      return c.json({ found: false, error: err.message }, 404);
    }
    console.error(err);
    return c.json({ error: "Upstream data source unavailable, please retry" }, 502);
  }
}
