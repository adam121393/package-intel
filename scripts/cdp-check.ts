import { existsSync } from "node:fs";
import { createAuthHeader, createCorrelationHeader } from "@coinbase/x402";

/**
 * Verifies CDP credentials and reports which (scheme, network) pairs the CDP
 * facilitator accepts.
 *
 * This exists because CDP's public docs list supported networks as "Base,
 * Polygon, Arbitrum, World, Solana" without stating whether Base *Sepolia* is
 * included, and /supported requires auth — so the only reliable answer comes
 * from asking with real credentials.
 *
 * Note: CDP JWTs are bound to a specific method + host + path, so the auth
 * header must be minted for the exact endpoint being called. Reusing a header
 * generated for /verify against /supported yields a 401.
 */

if (existsSync(".env")) process.loadEnvFile(".env");

const keyId = process.env.CDP_API_KEY_ID;
const keySecret = process.env.CDP_API_KEY_SECRET;

if (!keyId || !keySecret) {
  console.error(
    "Missing CDP_API_KEY_ID / CDP_API_KEY_SECRET.\n" +
      "Create them at https://portal.cdp.coinbase.com/api-keys/secret and add to .env.",
  );
  process.exit(1);
}

const BASE_SEPOLIA = "eip155:84532";
const BASE_MAINNET = "eip155:8453";

const HOST = "api.cdp.coinbase.com";
const BASE_PATH = "/platform/v2/x402";

async function get(path: string) {
  const authHeader = await createAuthHeader(keyId!, keySecret!, "GET", HOST, path);
  return fetch(`https://${HOST}${path}`, {
    headers: {
      Authorization: authHeader,
      "Correlation-Context": createCorrelationHeader(),
    },
  });
}

const res = await get(`${BASE_PATH}/supported`);

if (!res.ok) {
  const body = await res.text().catch(() => "");
  console.error(`GET ${BASE_PATH}/supported -> ${res.status} ${res.statusText}`);
  console.error(body.slice(0, 500));
  if (res.status === 401) {
    console.error(
      "\n401 means the credentials were rejected. Check that:\n" +
        "  - the key is a *Secret* API key (not a Client API key)\n" +
        "  - CDP_API_KEY_SECRET is the full `privateKey` value\n" +
        "  - the key belongs to the project you intend to use",
    );
  }
  process.exitCode = 1;
} else {
  const body = (await res.json()) as { kinds?: { scheme: string; network: string }[] };
  const kinds = body.kinds ?? [];

  console.log("CDP credentials accepted.\n");
  console.log("Supported (scheme, network) pairs:");
  for (const k of kinds) console.log(`  ${k.scheme.padEnd(8)} ${k.network}`);

  const has = (network: string) => kinds.some((k) => k.network === network && k.scheme === "exact");

  console.log();
  console.log(`Base Sepolia (${BASE_SEPOLIA}): ${has(BASE_SEPOLIA) ? "SUPPORTED" : "NOT supported"}`);
  console.log(`Base mainnet (${BASE_MAINNET}): ${has(BASE_MAINNET) ? "SUPPORTED" : "NOT supported"}`);

  if (has(BASE_SEPOLIA)) {
    console.log("\nYou can rehearse the full CDP path on testnet: set USE_CDP_FACILITATOR=true");
  } else {
    console.log(
      "\nBase Sepolia is not served by the CDP facilitator, so the testnet rehearsal\n" +
        "must keep using x402.org (leave USE_CDP_FACILITATOR unset). The CDP settlement\n" +
        "path will first execute on mainnet — start with a single small real payment.",
    );
  }
}
