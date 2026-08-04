import { existsSync } from "node:fs";
import { CdpClient } from "@coinbase/cdp-sdk";

/**
 * Creates (or fetches) a CDP-managed EVM account whose private key lives in
 * Coinbase's TEE rather than in this repo's .env.
 *
 * For *receiving* x402 payments the server only ever needs the public address
 * (PAY_TO) — no key material. That is the main reason to prefer this over a
 * raw generated key for anything holding real funds.
 *
 * Usage:
 *   npm run cdp-wallet                        # get-or-create the seller account
 *   npm run cdp-wallet -- --name my-buyer     # a differently-named account
 *   npm run cdp-wallet -- --faucet            # also request base-sepolia test funds
 */

if (existsSync(".env")) process.loadEnvFile(".env");

for (const key of ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "CDP_WALLET_SECRET"]) {
  if (!process.env[key]) {
    console.error(
      `Missing ${key}.\n\n` +
        "  CDP_API_KEY_ID / CDP_API_KEY_SECRET -> https://portal.cdp.coinbase.com/api-keys/secret\n" +
        "  CDP_WALLET_SECRET                   -> https://portal.cdp.coinbase.com/wallets/non-custodial/security\n\n" +
        "Add them to .env, then re-run.",
    );
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const nameFlag = args.indexOf("--name");
const accountName = nameFlag !== -1 ? args[nameFlag + 1] : "package-intel-seller";
const wantFaucet = args.includes("--faucet");

if (!accountName) {
  console.error("--name requires a value");
  process.exit(1);
}

const cdp = new CdpClient();

// Idempotent: re-running returns the same account rather than creating a new one,
// so this is safe to run repeatedly without scattering addresses.
const account = await cdp.evm.getOrCreateAccount({ name: accountName });

console.log(`CDP account "${accountName}"`);
console.log(`  address: ${account.address}`);
console.log();
console.log("Private key is held by CDP (TEE) — there is nothing to copy into .env.");
console.log(`To receive payments here, set:  PAY_TO=${account.address}`);

if (wantFaucet) {
  console.log("\nRequesting Base Sepolia test funds...");
  for (const token of ["eth", "usdc"] as const) {
    try {
      const res = await cdp.evm.requestFaucet({
        address: account.address,
        network: "base-sepolia",
        token,
      });
      console.log(`  ${token}: https://sepolia.basescan.org/tx/${res.transactionHash}`);
    } catch (err) {
      console.log(`  ${token}: failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
