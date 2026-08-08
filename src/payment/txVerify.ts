/**
 * Verifies a USDC transfer on Base, presented by the caller as a transaction
 * hash instead of an x402 signature.
 *
 * This is the "manual" payment path: the buyer sends USDC themselves and hands
 * us the hash. It exists for agents that cannot speak x402's header protocol.
 * The x402 path remains the better one — it is gasless for the buyer, needs no
 * confirmation wait, and the facilitator handles replay protection — so this
 * is deliberately additive.
 *
 * Each check below corresponds to a distinct way of being handed a hash that
 * does not actually pay us:
 *   - wrong chain          → a transfer on some other network
 *   - not confirmed/failed → a reverted or pending transaction
 *   - wrong token          → a transfer of some worthless token
 *   - wrong recipient      → a real USDC transfer to somebody else
 *   - insufficient amount  → paying $0.001 for a $0.01 endpoint
 *   - too old              → replaying an ancient transfer
 *   - already used         → replaying one of ours (see usedTx.ts)
 */

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface TxVerifyParams {
  txHash: string;
  /** Address that must receive the funds. */
  payTo: string;
  /** ERC-20 contract the transfer must be denominated in. */
  asset: string;
  /** Minimum acceptable amount, in the asset's smallest unit. */
  minAmount: bigint;
  chainId: number;
  rpcUrl: string;
  maxAgeSeconds: number;
}

export type TxVerifyResult =
  | { ok: true; amount: bigint; from: string; blockNumber: bigint }
  | { ok: false; reason: string };

interface RpcLog {
  address: string;
  topics: string[];
  data: string;
}

interface RpcReceipt {
  status: string;
  blockNumber: string;
  from: string;
  logs: RpcLog[];
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`RPC ${method}: ${body.error.message}`);
  return body.result as T;
}

/** `0x` + 64 hex chars. Rejected early so a malformed value never reaches the RPC. */
export function isTxHashShape(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

/** Last 20 bytes of a 32-byte topic, as a lowercase address. */
function topicToAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

export async function verifyUsdcPayment(params: TxVerifyParams): Promise<TxVerifyResult> {
  const { txHash, payTo, asset, minAmount, chainId, rpcUrl, maxAgeSeconds } = params;

  if (!isTxHashShape(txHash)) {
    return { ok: false, reason: "tx_hash must be a 0x-prefixed 32-byte hex string" };
  }

  let receipt: RpcReceipt | null;
  let observedChainId: string;
  try {
    // The chain id is checked against the node we are querying, not against the
    // caller's claim — otherwise a transfer on a different chain with the same
    // hash shape would be accepted by pointing us at the wrong RPC.
    [receipt, observedChainId] = await Promise.all([
      rpc<RpcReceipt | null>(rpcUrl, "eth_getTransactionReceipt", [txHash]),
      rpc<string>(rpcUrl, "eth_chainId", []),
    ]);
  } catch (err) {
    return { ok: false, reason: `could not reach the chain to verify: ${(err as Error).message}` };
  }

  if (Number(BigInt(observedChainId)) !== chainId) {
    return { ok: false, reason: `RPC is on chain ${BigInt(observedChainId)}, expected ${chainId}` };
  }
  if (!receipt) {
    return { ok: false, reason: "transaction not found or not yet confirmed" };
  }
  if (BigInt(receipt.status) !== 1n) {
    return { ok: false, reason: "transaction reverted" };
  }

  // Sum every matching transfer in the receipt: a batching contract may pay us
  // across more than one log, and taking only the first would under-count.
  let total = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== asset.toLowerCase()) continue;
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (log.topics.length < 3) continue;
    if (topicToAddress(log.topics[2]!) !== payTo.toLowerCase()) continue;
    total += BigInt(log.data === "0x" ? "0x0" : log.data);
  }

  if (total === 0n) {
    return { ok: false, reason: `no ${asset} transfer to ${payTo} found in that transaction` };
  }
  if (total < minAmount) {
    return { ok: false, reason: `paid ${total} but this endpoint requires ${minAmount}` };
  }

  // Age is bounded so an old transfer cannot be redeemed indefinitely, which
  // also bounds how long the used-hash ledger must remember anything.
  try {
    const block = await rpc<{ timestamp: string } | null>(rpcUrl, "eth_getBlockByNumber", [
      receipt.blockNumber,
      false,
    ]);
    if (block) {
      const ageSeconds = Math.floor(Date.now() / 1000) - Number(BigInt(block.timestamp));
      if (ageSeconds > maxAgeSeconds) {
        return {
          ok: false,
          reason: `transaction is ${ageSeconds}s old; must be used within ${maxAgeSeconds}s of confirmation`,
        };
      }
    }
  } catch {
    // Block lookup is best-effort: the payment itself is already proven, and
    // the single-use ledger still prevents reuse. Failing the call here would
    // reject a genuine payer over an RPC hiccup.
  }

  return {
    ok: true,
    amount: total,
    from: receipt.from.toLowerCase(),
    blockNumber: BigInt(receipt.blockNumber),
  };
}
