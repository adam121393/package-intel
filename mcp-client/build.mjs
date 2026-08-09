/**
 * Bundles the MCP server into a single file with no runtime dependencies.
 *
 * Why bundle at all: the install command in every listing is
 * `npx -y package-intel-mcp`, and npx installs the whole dependency tree before
 * the process starts. With 123 packages — most of them viem and the x402 client,
 * which the free tools never touch — a cold start took long enough to exceed
 * Claude Code's 30-second MCP startup timeout. The first thing a new user saw
 * was a connection failure.
 *
 * Two things this file exists to get right, both of which broke a one-line
 * esbuild invocation:
 *
 * 1. A shebang must be the very first bytes of the output. esbuild preserves the
 *    one in the entry file, but anything prepended via --banner lands above it,
 *    so the shebang ends up on line 2 where it is a syntax error rather than a
 *    shebang. It is therefore emitted here, as the first line of the banner, and
 *    deliberately absent from src/server.ts.
 *
 * 2. axios depends on form-data and combined-stream, which are CommonJS and call
 *    require() for Node builtins. Bundled to ESM there is no require in scope,
 *    and the process dies on startup with "Dynamic require of util is not
 *    supported". The createRequire shim below restores it.
 */

import { build } from "esbuild";

const banner = [
  "#!/usr/bin/env node",
  // Restores require() for the CommonJS dependencies bundled into this ESM file.
  'import { createRequire as __createRequire } from "node:module";',
  "const require = __createRequire(import.meta.url);",
].join("\n");

const result = await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: banner },
  // Keeps the output readable enough to audit, which matters for something
  // people run locally against their own dependency lists.
  minify: false,
  legalComments: "none",
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`bundled dist/server.js — ${(bytes / 1024 / 1024).toFixed(2)} MB, 0 runtime dependencies`);
