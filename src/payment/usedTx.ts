/**
 * Single-use ledger for transaction hashes presented as payment.
 *
 * A settled USDC transfer is public on-chain, so without this a caller could
 * replay one $0.01 transfer for unlimited calls, and anyone reading Base could
 * replay someone else's. This is the whole security value of the tx_hash path;
 * the on-chain verification alone proves a payment happened, not that it has
 * not already been spent here.
 */

export interface UsedTxStore {
  /**
   * Reserves a hash. Returns true if it was previously unspent.
   *
   * A claim is provisional: it blocks concurrent double-spends immediately, but
   * is only made permanent by `commit`. This mirrors x402, which never settles
   * a payment for a response of 400 or worse — a caller whose request fails
   * must be able to retry with the same payment.
   */
  claim(txHash: string): boolean;
  /** Makes a claim permanent, after the request was actually served. */
  commit(txHash: string): void;
  /** Returns an unserved claim to the pool, so the payment is not consumed. */
  release(txHash: string): void;
  size(): number;
}

/**
 * In-process ledger, optionally durable.
 *
 * `claim` performs its check-and-insert with no `await` in between, so it is
 * atomic against concurrent requests: JS runs it to completion before another
 * task can observe the set. Persisting is fire-and-forget *after* the claim, so
 * a slow disk cannot open a double-spend window.
 */
export class MemoryUsedTxStore implements UsedTxStore {
  protected readonly used = new Set<string>();

  claim(txHash: string): boolean {
    const key = txHash.toLowerCase();
    if (this.used.has(key)) return false;
    this.used.add(key);
    return true;
  }

  commit(txHash: string): void {
    this.onCommitted(txHash.toLowerCase());
  }

  release(txHash: string): void {
    this.used.delete(txHash.toLowerCase());
  }

  size(): number {
    return this.used.size;
  }

  protected onCommitted(_key: string): void {
    // Overridden by the durable subclass.
  }
}

/**
 * Adds an append-only log so a restart does not forget which hashes were spent.
 *
 * Without it, restarting the process would let every previously used hash be
 * redeemed again — and this service restarts often enough that it matters.
 * Entries older than the acceptance window are pruned on load, since a
 * transaction too old to be accepted can never be replayed anyway.
 */
export class FileUsedTxStore extends MemoryUsedTxStore {
  private appendQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private readonly fs: typeof import("node:fs/promises"),
  ) {
    super();
  }

  static async open(path: string, maxAgeMs: number): Promise<FileUsedTxStore> {
    const fs = await import("node:fs/promises");
    const store = new FileUsedTxStore(path, fs);
    try {
      const raw = await fs.readFile(path, "utf8");
      const cutoff = Date.now() - maxAgeMs;
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        const [hash, at] = line.split("\t");
        if (!hash) continue;
        // A hash older than the acceptance window cannot be redeemed again, so
        // it need not be remembered — this keeps the file from growing forever.
        if (at && Number(at) < cutoff) continue;
        store.used.add(hash);
      }
    } catch {
      // No ledger yet — first run.
    }
    return store;
  }

  protected override onCommitted(key: string): void {
    // Only committed spends reach the ledger, so a request that failed after
    // claiming leaves no trace and its payment survives a restart.
    // Serialised so concurrent writes cannot interleave partial lines, and
    // detached from the request so disk latency never delays a response.
    this.appendQueue = this.appendQueue
      .then(() => this.fs.appendFile(this.path, `${key}\t${Date.now()}\n`, "utf8"))
      .catch((err) => {
        console.error("used-tx ledger append failed; continuing in memory only:", err);
      });
  }
}

/**
 * Durable under Node, in-memory elsewhere. The import is dynamic so that merely
 * loading this module does not pull `node:fs` into a runtime that lacks it.
 */
export async function createUsedTxStore(
  path: string | undefined,
  maxAgeMs: number,
): Promise<UsedTxStore> {
  const isNode = Boolean((globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node);
  if (!isNode || !path) return new MemoryUsedTxStore();
  try {
    return await FileUsedTxStore.open(path, maxAgeMs);
  } catch (err) {
    console.error("Could not open used-tx ledger, falling back to memory:", err);
    return new MemoryUsedTxStore();
  }
}
