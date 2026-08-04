import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

function generate(label: string) {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  console.log(`${label}:`);
  console.log(`  address:     ${account.address}`);
  console.log(`  private key: ${privateKey}`);
  console.log();
}

console.log("=== TESTNET-ONLY keypairs — do NOT fund with real assets, do NOT reuse on mainnet ===\n");
generate("Seller (PAY_TO — put this address in .env)");
generate("Buyer (fund with Base Sepolia test USDC via faucet.circle.com, use private key in test-buyer.ts)");
