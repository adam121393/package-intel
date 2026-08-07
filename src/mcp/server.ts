import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { wrapAxiosWithPaymentFromConfig } from "@x402/axios";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import axios, { type AxiosInstance } from "axios";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

/**
 * MCP wrapper for the Package & Dependency Intelligence API.
 *
 * Runs on the *buyer's* machine (Claude Desktop / Cursor). Raw package data is
 * free and needs no wallet at all — that is the default experience, and the
 * server starts fine without any configuration. If a wallet key is present it
 * additionally registers the paid tools, and on a 402 the axios wrapper signs a
 * USDC payment from that wallet and retries.
 *
 * The wallet key belongs to the agent operator, not the API operator.
 */

if (existsSync(".env")) process.loadEnvFile(".env");

const baseURL = process.env.API_URL ?? "http://localhost:4021";
const network = (process.env.NETWORK ?? "eip155:84532") as `${string}:${string}`;
const privateKey = process.env.X402_PRIVATE_KEY ?? process.env.BUYER_PRIVATE_KEY;

const plainApi = axios.create({ baseURL, timeout: 60_000 });

/**
 * A malformed key is a hard failure rather than a quiet fall back to free mode:
 * someone who set the variable meant to pay, and silently serving them a
 * smaller tool list would look like the paid tools had vanished for no reason.
 */
function buildPaidApi(key: string): { api: AxiosInstance; address: string } {
  try {
    const account = privateKeyToAccount(key as `0x${string}`);
    return {
      api: wrapAxiosWithPaymentFromConfig(axios.create({ baseURL, timeout: 60_000 }), {
        schemes: [{ network, client: new ExactEvmScheme(account) }],
      }),
      address: account.address,
    };
  } catch (err) {
    console.error(
      `X402_PRIVATE_KEY is set but is not a valid private key: ${err instanceof Error ? err.message : String(err)}\n` +
        "Expected a 0x-prefixed 32-byte hex string. Unset it to run in free mode.",
    );
    process.exit(1);
  }
}

const paidMode = Boolean(privateKey);
const paid = privateKey ? buildPaidApi(privateKey) : null;
const api = paid?.api ?? plainApi;

const UPGRADE_HINT =
  "A consolidated 0-100 health score combining these signals is available via the " +
  "package_health tool. To enable it, set X402_PRIVATE_KEY to a wallet funded with " +
  "USDC on Base; calls cost $0.01 each.";

// Emitted once per process, not per call: a hint repeated on every response is
// pure context bloat for the agent reading it.
let upgradeHintSent = false;

function attachUpgradeHint(data: unknown): unknown {
  if (paidMode || upgradeHintSent) return data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data;
  upgradeHintSent = true;
  return { ...data, _upgrade: UPGRADE_HINT };
}

const ecosystemSchema = z.enum(["npm", "pypi"]).describe("Package ecosystem: 'npm' or 'pypi'");
const nameSchema = z.string().min(1).describe("Package name, e.g. 'express' or 'requests'");

/** Turns upstream/axios failures into readable tool errors instead of stack traces. */
async function callApi(
  path: string,
  request: () => Promise<{ data: unknown }>,
  options: { free?: boolean } = {},
) {
  try {
    const { data } = await request();
    const payload = options.free ? attachUpgradeHint(data) : data;
    return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      const retryAfter = err.response.headers["retry-after"];
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text:
              `Free tier rate limit reached on ${path}.` +
              (retryAfter ? ` Retry in ${retryAfter}s.` : "") +
              " Paid endpoints are not rate limited.",
          },
        ],
      };
    }
    const message = axios.isAxiosError(err)
      ? `${err.response?.status ?? "network error"}: ${JSON.stringify(err.response?.data ?? err.message)}`
      : String(err);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Request to ${path} failed — ${message}` }],
    };
  }
}

const mcp = new McpServer({ name: "package-intel", version: "1.0.0" });

const readOnly = { readOnlyHint: true, openWorldHint: true };

// ---------------------------------------------------------------------------
// Free tools — always registered, no wallet required.
// ---------------------------------------------------------------------------

mcp.registerTool(
  "package_snapshot",
  {
    description:
      "Get a consolidated snapshot of an npm or PyPI package: latest version, license, description, repository, weekly downloads, maintainers, last publish date, and deprecation status. Free, no payment required.",
    inputSchema: { ecosystem: ecosystemSchema, name: nameSchema },
    annotations: readOnly,
  },
  async ({ ecosystem, name }) => {
    const path = `/v1/package/${ecosystem}/${encodeURIComponent(name)}`;
    return callApi(path, () => plainApi.get(path), { free: true });
  },
);

mcp.registerTool(
  "package_vulns",
  {
    description:
      "List known vulnerabilities (OSV.dev) for an npm or PyPI package. Pass a version to scope results to that version; omit it to see every advisory ever filed against the package. Free, no payment required.",
    inputSchema: {
      ecosystem: ecosystemSchema,
      name: nameSchema,
      version: z.string().optional().describe("Optional exact version, e.g. '5.2.1'"),
    },
    annotations: readOnly,
  },
  async ({ ecosystem, name, version }) => {
    const query = version ? `?version=${encodeURIComponent(version)}` : "";
    const path = `/v1/vulns/${ecosystem}/${encodeURIComponent(name)}${query}`;
    return callApi(path, () => plainApi.get(path), { free: true });
  },
);

mcp.registerTool(
  "package_deps",
  {
    description:
      "Get the dependency graph for an npm or PyPI package: direct and transitive dependencies with versions and counts, with deprecated direct dependencies flagged. Free, no payment required.",
    inputSchema: {
      ecosystem: ecosystemSchema,
      name: nameSchema,
      version: z.string().optional().describe("Optional exact version; defaults to latest"),
    },
    annotations: readOnly,
  },
  async ({ ecosystem, name, version }) => {
    const query = version ? `?version=${encodeURIComponent(version)}` : "";
    const path = `/v1/deps/${ecosystem}/${encodeURIComponent(name)}${query}`;
    return callApi(path, () => plainApi.get(path), { free: true });
  },
);

mcp.registerTool(
  "package_downloads",
  {
    description:
      "Get download counts for an npm or PyPI package over a time range. Free, no payment required.",
    inputSchema: {
      ecosystem: ecosystemSchema,
      name: nameSchema,
      range: z
        .enum(["last-day", "last-week", "last-month", "last-year"])
        .optional()
        .describe("npm only; PyPI always returns last-week"),
    },
    annotations: readOnly,
  },
  async ({ ecosystem, name, range }) => {
    const query = range ? `?range=${range}` : "";
    const path = `/v1/downloads/${ecosystem}/${encodeURIComponent(name)}${query}`;
    return callApi(path, () => plainApi.get(path), { free: true });
  },
);

// ---------------------------------------------------------------------------
// Paid tools — registered only when a funded wallet is configured, so an agent
// without one never sees a tool it is guaranteed to fail at.
// ---------------------------------------------------------------------------

if (paidMode) {
  mcp.registerTool(
    "package_health",
    {
      description:
        "Get a 0-100 health/risk score for an npm or PyPI package, with maintenance, popularity, security, and freshness sub-scores plus a rationale. Use this to decide whether a dependency is safe to adopt. Costs $0.01 in USDC per call.",
      inputSchema: { ecosystem: ecosystemSchema, name: nameSchema },
      annotations: readOnly,
    },
    async ({ ecosystem, name }) => {
      const path = `/v1/health/${ecosystem}/${encodeURIComponent(name)}`;
      return callApi(path, () => api.get(path));
    },
  );

  mcp.registerTool(
    "package_batch_health",
    {
      description:
        "Score up to 50 packages in one call — use this to audit an entire package.json or requirements.txt at once instead of calling package_health repeatedly. Costs $0.02 in USDC per call.",
      inputSchema: {
        queries: z
          .array(z.object({ ecosystem: ecosystemSchema, name: nameSchema }))
          .min(1)
          .max(50)
          .describe("Packages to score, max 50"),
      },
      annotations: readOnly,
    },
    async ({ queries }) => callApi("/v1/batch", () => api.post("/v1/batch", { queries })),
  );
}

const transport = new StdioServerTransport();
await mcp.connect(transport);
// stderr only: stdout is the MCP protocol channel and must not be polluted.
console.error(
  paid
    ? `package-intel MCP server ready (api=${baseURL}, 6 tools, payer=${paid.address})`
    : `package-intel MCP server ready (api=${baseURL}, 4 free tools, no wallet configured)`,
);
