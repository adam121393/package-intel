import { existsSync } from "node:fs";
import axios from "axios";
import { wrapAxiosWithPaymentFromConfig } from "@x402/axios";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

if (existsSync(".env")) process.loadEnvFile(".env");

const privateKey = process.env.BUYER_PRIVATE_KEY;
if (!privateKey) {
  console.error(
    "Set BUYER_PRIVATE_KEY in .env to a testnet keypair's private key\n" +
      "(from `npm run gen-wallet`), funded with Base Sepolia test USDC via faucet.circle.com.",
  );
  process.exit(1);
}

const baseURL = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4021}`;
const network = (process.env.NETWORK ?? "eip155:84532") as `${string}:${string}`;
const path = process.argv[2] ?? "/v1/health/npm/express";
const account = privateKeyToAccount(privateKey as `0x${string}`);

const api = wrapAxiosWithPaymentFromConfig(axios.create({ baseURL }), {
  schemes: [{ network, client: new ExactEvmScheme(account) }],
});

console.log(`Buyer address: ${account.address}`);
console.log(`Requesting ${path === "/v1/batch" ? "POST" : "GET"} ${baseURL}${path} ...`);

try {
  const response =
    path === "/v1/batch"
      ? await api.post(path, { queries: [{ ecosystem: "npm", name: "express" }, { ecosystem: "pypi", name: "requests" }] })
      : await api.get(path);

  console.log(`Status: ${response.status}`);
  console.log(JSON.stringify(response.data, null, 2));
} catch (err) {
  if (axios.isAxiosError(err)) {
    console.error(`Request failed: ${err.response?.status ?? err.message}`);
    console.error(JSON.stringify(err.response?.data ?? err.message, null, 2));
    process.exit(1);
  }
  throw err;
}
