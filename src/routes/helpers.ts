import type { Context } from "hono";
import { UpstreamNotFoundError } from "../cache.js";
import type { Ecosystem } from "../types.js";

export function parseEcosystem(value: string): Ecosystem | null {
  return value === "npm" || value === "pypi" ? value : null;
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
