const BASE_MAINNET = "eip155:8453";
const BASE_SEPOLIA = "eip155:84532";

export interface AppConfig {
  port: number;
  payTo: `0x${string}`;
  network: `${string}:${string}`;
  isMainnet: boolean;
  useCdpFacilitator: boolean;
  facilitatorUrl: string;
  publicUrl: string;
  serviceName: string;
  /**
   * Bazaar discovery declarations. The validator behind them (Ajv) compiles
   * schemas with `new Function`, which Cloudflare Workers forbids, so this can
   * be turned off for runtimes that disallow dynamic code evaluation.
   */
  bazaarEnabled: boolean;
  /** Blocking facilitator sync at startup. */
  syncFacilitator: boolean;
  /**
   * Shared secret proving that `x-stable-ip` came from our own Worker proxy
   * rather than from the caller. Without it the free-tier rate limit is
   * trivially bypassed by forging that header — see src/rateLimit.ts.
   */
  proxySecret?: string;
  /**
   * Accept a confirmed on-chain USDC transfer, referenced by transaction hash,
   * as an alternative to an x402 signature. For agents that cannot speak x402's
   * header protocol. See src/payment/txGate.ts.
   */
  txPaymentEnabled: boolean;
  /** JSON-RPC endpoint used to verify those transfers. */
  rpcUrl: string;
  /** ERC-20 the transfer must be denominated in. */
  usdcAddress: string;
  /**
   * How long after confirmation a transaction may still be redeemed. Bounds
   * both the replay window and how much the used-hash ledger must remember.
   */
  txMaxAgeSeconds: number;
  /** Append-only ledger of spent hashes; undefined keeps it in memory only. */
  usedTxLedgerPath?: string;
}

/** Circulating USDC, per network. */
const USDC_ADDRESS: Record<string, string> = {
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base mainnet
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia
};

const DEFAULT_RPC: Record<string, string> = {
  "eip155:8453": "https://mainnet.base.org",
  "eip155:84532": "https://sepolia.base.org",
};

/**
 * Loads a local .env file when running under Node. Cloudflare Workers has no
 * filesystem — there, variables and secrets arrive as bindings and are exposed
 * on process.env by the `nodejs_compat_populate_process_env` flag, so this is
 * skipped entirely.
 */
function loadDotEnvIfNode(): void {
  const proc = globalThis.process as
    | { loadEnvFile?: (p: string) => void; versions?: { node?: string } }
    | undefined;
  if (!proc?.versions?.node || typeof proc.loadEnvFile !== "function") return;
  try {
    proc.loadEnvFile(".env");
  } catch {
    // No .env present (or unreadable) — fall back to the ambient environment.
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let cached: AppConfig | undefined;

/**
 * Resolves configuration on first use rather than at module load, so that on
 * Workers the environment bindings are guaranteed to be populated by the time
 * we read them.
 */
export function getConfig(): AppConfig {
  if (cached) return cached;

  loadDotEnvIfNode();

  const network = (process.env.NETWORK ?? BASE_SEPOLIA) as `${string}:${string}`;
  const isMainnet = network === BASE_MAINNET;

  // The CDP facilitator is mandatory on mainnet — it settles real USDC and is what
  // auto-catalogs the service in the Bazaar. On testnet it is opt-in via
  // USE_CDP_FACILITATOR=true, so the CDP credentials and settlement path can be
  // rehearsed against test funds before any real money is involved.
  const useCdpFacilitator = isMainnet || process.env.USE_CDP_FACILITATOR === "true";

  if (useCdpFacilitator) {
    requireEnv("CDP_API_KEY_ID");
    requireEnv("CDP_API_KEY_SECRET");
  }

  cached = {
    port: Number(process.env.PORT ?? 4021),
    payTo: requireEnv("PAY_TO") as `0x${string}`,
    network,
    isMainnet,
    useCdpFacilitator,
    facilitatorUrl: process.env.FACILITATOR_URL ?? "https://x402.org/facilitator",
    // Public origin this service is reachable at, used for absolute resource
    // URLs in the discovery manifest. Indexers need real URLs, not localhost.
    publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4021}`).replace(
      /\/$/,
      "",
    ),
    serviceName: process.env.SERVICE_NAME ?? "Package & Dependency Intelligence",
    bazaarEnabled: process.env.BAZAAR_ENABLED !== "false",
    syncFacilitator: process.env.SYNC_FACILITATOR !== "false",
    proxySecret: process.env.PROXY_SECRET,
    txPaymentEnabled: process.env.TX_PAYMENT_ENABLED !== "false",
    rpcUrl: process.env.BASE_RPC_URL ?? DEFAULT_RPC[network] ?? DEFAULT_RPC[BASE_MAINNET]!,
    usdcAddress:
      process.env.USDC_CONTRACT_ADDRESS ?? USDC_ADDRESS[network] ?? USDC_ADDRESS[BASE_MAINNET]!,
    txMaxAgeSeconds: Number(process.env.TX_MAX_AGE_SECONDS ?? 900), // 15 minutes
    usedTxLedgerPath: process.env.USED_TX_LEDGER_PATH ?? ".used-tx.log",
  };

  if (cached.isMainnet && !cached.proxySecret) {
    console.warn(
      "PROXY_SECRET is not set. Free-tier rate limiting will trust the x-stable-ip\n" +
        "header as sent, which any caller can forge. Set the same value here and in\n" +
        "the Worker (npx wrangler secret put PROXY_SECRET) to close that.",
    );
  }

  return cached;
}
