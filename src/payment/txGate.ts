import type { Context, MiddlewareHandler, Next } from "hono";
import { type PaidCatalogEntry, paidEntries } from "../catalog.js";
import type { AppConfig } from "../config.js";
import { isTxHashShape, verifyUsdcPayment } from "./txVerify.js";
import { createUsedTxStore, type UsedTxStore } from "./usedTx.js";

/**
 * Chooses between the two ways of paying for a paid route.
 *
 * Requests carrying a `tx_hash` are settled by on-chain verification here;
 * everything else is handed to the x402 middleware untouched, so the existing
 * signature-based path behaves exactly as it did before this file existed.
 *
 * The delegation matters: x402's middleware is registered *inside* this one
 * rather than beside it. Registered as siblings, a request we had just verified
 * on-chain would still reach the x402 middleware and be answered with a 402 —
 * paid, then refused.
 */

const USDC_DECIMALS = 6;

/** "$0.01" -> 10000n. String arithmetic, because 0.01 is not representable in binary float. */
export function priceToAtomicUsdc(price: string): bigint {
  const cleaned = price.replace(/[$,\s]/g, "");
  const [whole = "0", frac = ""] = cleaned.split(".");
  const scaled = (frac + "0".repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return BigInt(whole || "0") * 10n ** BigInt(USDC_DECIMALS) + BigInt(scaled || "0");
}

interface CompiledRoute {
  entry: PaidCatalogEntry;
  method: string;
  test: (path: string) => boolean;
}

/** Turns "GET /v1/health/:ecosystem/:name" into a method + path matcher. */
function compile(entry: PaidCatalogEntry): CompiledRoute {
  const [method = "GET", pattern = ""] = entry.route.split(" ");
  const source = `^${pattern.replace(/:[^/]+/g, "[^/]+").replace(/\//g, "\\/")}$`;
  const re = new RegExp(source);
  return { entry, method: method.toUpperCase(), test: (path) => re.test(path) };
}

export function matchPaidRoute(method: string, path: string): PaidCatalogEntry | null {
  const normalised = path.length > 1 ? path.replace(/\/$/, "") : path;
  for (const route of COMPILED) {
    if (route.method === method.toUpperCase() && route.test(normalised)) return route.entry;
  }
  return null;
}

const COMPILED: CompiledRoute[] = paidEntries().map(compile);

/**
 * Accepted from the query string on any method, and additionally from a JSON
 * body. Hono caches the parsed body, so reading it here does not consume it
 * before the route handler runs.
 */
async function extractTxHash(c: Context): Promise<string | null> {
  const fromQuery = c.req.query("tx_hash");
  if (fromQuery) return fromQuery;

  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    const body = (await c.req.json()) as Record<string, unknown> | null;
    const value = body?.tx_hash;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null; // Malformed body: let the normal path produce the error.
  }
}

function challenge(entry: PaidCatalogEntry, config: AppConfig, reason?: string) {
  return {
    error: "Payment required",
    reason,
    price: entry.price,
    resource: entry.route,
    payment: {
      // x402 is listed first deliberately: it is gasless for the buyer and needs
      // no confirmation wait, so an agent able to use it should.
      preferred: {
        method: "x402",
        description:
          "Send an x402 PAYMENT-SIGNATURE header. Gasless for the buyer, settled by the facilitator, no confirmation wait.",
      },
      alternative: {
        method: "tx_hash",
        description:
          `Send ${entry.price} of USDC on ${config.network} to ${config.payTo}, then retry this request with ?tx_hash=<hash> (or "tx_hash" in the JSON body).`,
        asset: config.usdcAddress,
        payTo: config.payTo,
        network: config.network,
        amountAtomic: priceToAtomicUsdc(entry.price).toString(),
        mustBeUsedWithinSeconds: config.txMaxAgeSeconds,
        warning:
          "A transaction hash is public the moment it confirms, and the first caller to present it here consumes it. " +
          "Anyone watching the chain can therefore redeem your payment before you do. Retry promptly, and prefer x402, " +
          "which is not exposed to this.",
      },
    },
  };
}

export function createTxPaymentGate(
  config: AppConfig,
  x402Middleware: MiddlewareHandler,
): MiddlewareHandler {
  // Opened lazily so createApp stays synchronous; the promise is created once
  // and awaited by every request thereafter.
  let storePromise: Promise<UsedTxStore> | undefined;
  const store = () => {
    storePromise ??= createUsedTxStore(config.usedTxLedgerPath, config.txMaxAgeSeconds * 1000);
    return storePromise;
  };

  return async (c: Context, next: Next) => {
    const entry = matchPaidRoute(c.req.method, c.req.path);
    if (!entry) return next(); // Free route — no payment of any kind.

    if (!config.txPaymentEnabled) return x402Middleware(c, next);

    const txHash = await extractTxHash(c);
    if (!txHash) {
      // Delegate to x402, then advertise the alternative on the way out. A
      // payment method nobody can discover is not a payment method — but the
      // 402 *body* is the x402 protocol's, so the advert goes in headers where
      // it cannot confuse a client parsing that body.
      const result = await x402Middleware(c, next);
      const response = result ?? c.res;
      if (response?.status !== 402) return response;

      const headers = new Headers(response.headers);
      headers.set("X-Payment-Alternative", "tx_hash");
      headers.set(
        "X-Payment-Alternative-Info",
        `Send ${priceToAtomicUsdc(entry.price)} units of USDC (${config.usdcAddress}) ` +
          `on ${config.network} to ${config.payTo}, then retry with ?tx_hash=<hash> within ${config.txMaxAgeSeconds}s.`,
      );
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    if (!isTxHashShape(txHash)) {
      return c.json(challenge(entry, config, "tx_hash must be a 0x-prefixed 32-byte hex string"), 400);
    }

    const verdict = await verifyUsdcPayment({
      txHash,
      payTo: config.payTo,
      asset: config.usdcAddress,
      minAmount: priceToAtomicUsdc(entry.price),
      chainId: Number(config.network.split(":")[1]),
      rpcUrl: config.rpcUrl,
      maxAgeSeconds: config.txMaxAgeSeconds,
    });

    if (!verdict.ok) {
      return c.json(challenge(entry, config, verdict.reason), 402);
    }

    // Claimed only after the payment is proven, and before anything is served,
    // so a hash cannot be spent twice even by two simultaneous requests.
    const claimed = (await store()).claim(txHash);
    if (!claimed) {
      return c.json(
        challenge(entry, config, "that transaction has already been used to pay for a call"),
        402,
      );
    }

    console.log(
      JSON.stringify({
        event: "tx_payment_accepted",
        route: entry.route,
        price: entry.price,
        amount: verdict.amount.toString(),
        from: verdict.from,
        txHash: txHash.toLowerCase(),
        block: verdict.blockNumber.toString(),
      }),
    );

    c.header("X-Payment-Method", "tx_hash");
    c.header("X-Payment-Tx", txHash.toLowerCase());
    return next();
  };
}
