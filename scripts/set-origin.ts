import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Repoints the stable Worker proxy at a new tunnel hostname and redeploys.
 *
 * Quick tunnels get a fresh random hostname every restart, so this is the
 * one command to run after restarting `cloudflared`.
 *
 *   npm run set-origin -- https://something-new.trycloudflare.com
 */

const origin = process.argv[2];

if (!origin || !/^https:\/\/[^\s/]+$/.test(origin.replace(/\/$/, ""))) {
  console.error(
    "Usage: npm run set-origin -- https://<host>\n\n" +
      "Pass the current tunnel URL printed by cloudflared, e.g.\n" +
      "  npm run set-origin -- https://pubmed-sheffield-moving-sierra.trycloudflare.com",
  );
  process.exit(1);
}

const clean = origin.replace(/\/$/, "");
const path = "wrangler.toml";
const toml = readFileSync(path, "utf8");

if (!/^ORIGIN\s*=/m.test(toml)) {
  console.error("Could not find an ORIGIN entry in wrangler.toml.");
  process.exit(1);
}

writeFileSync(path, toml.replace(/^ORIGIN\s*=.*$/m, `ORIGIN = "${clean}"`));
console.log(`ORIGIN -> ${clean}`);

console.log("Deploying...");
execFileSync("npx", ["wrangler", "deploy"], { stdio: "inherit", shell: true });
