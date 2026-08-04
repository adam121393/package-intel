import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { wrapAxiosWithPaymentFromConfig } from "@x402/axios";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import axios from "axios";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

/**
 * MCP wrapper for the Package & Dependency Intelligence API.
 *
 * This runs on the *buyer's* machine (Claude Desktop / Cursor) and pays the
 * hosted API on their behalf: each tool call hits the paid HTTP endpoint, and
 * on a 402 the axios wrapper signs a USDC payment from the configured wallet
 * and retries automatically.
 *
 * The wallet key here belongs to the agent operator, not the API operator.
 */

if (existsSync(".env")) process.loadEnvFile(".env");

const privateKey = process.env.X402_PRIVATE_KEY ?? process.env.BUYER_PRIVATE_KEY;
if (!privateKey) {
  console.error(
    "Missing X402_PRIVATE_KEY. Set it to the private key of a wallet funded with USDC\n" +
      "on the configured network so this server can pay for API calls.",
  );
  process.exit(1);
}

const baseURL = process.env.API_URL ?? "http://localhost:4021";
const network = (process.env.NETWORK ?? "eip155:84532") as `${string}:${string}`;
const account = privateKeyToAccount(privateKey as `0x${string}`);

const api = wrapAxiosWithPaymentFromConfig(axios.create({ baseURL, timeout: 60_000 }), {
  schemes: [{ network, client: new ExactEvmScheme(account) }],
});

const ecosystemSchema = z.enum(["npm", "pypi"]).describe("Package ecosystem: 'npm' or 'pypi'");
const nameSchema = z.string().min(1).describe("Package name, e.g. 'express' or 'requests'");

/** Turns upstream/axios failures into readable tool errors instead of stack traces. */
async function callApi(path: string, request: () => Promise<{ data: unknown }>) {
  try {
    const { data } = await request();
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
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

mcp.registerTool(
  "package_health",
  {
    description:
      "Get a 0-100 health/risk score for an npm or PyPI package, with maintenance, popularity, security, and freshness sub-scores plus a rationale. Use this to decide whether a dependency is safe to adopt.",
    inputSchema: { ecosystem: ecosystemSchema, name: nameSchema },
  },
  async ({ ecosystem, name }) => {
    const path = `/v1/health/${ecosystem}/${encodeURIComponent(name)}`;
    return callApi(path, () => api.get(path));
  },
);

mcp.registerTool(
  "package_vulns",
  {
    description:
      "List known vulnerabilities (OSV.dev) for an npm or PyPI package. Pass a version to scope results to that version; omit it to see every advisory ever filed against the package.",
    inputSchema: {
      ecosystem: ecosystemSchema,
      name: nameSchema,
      version: z.string().optional().describe("Optional exact version, e.g. '5.2.1'"),
    },
  },
  async ({ ecosystem, name, version }) => {
    const query = version ? `?version=${encodeURIComponent(version)}` : "";
    const path = `/v1/vulns/${ecosystem}/${encodeURIComponent(name)}${query}`;
    return callApi(path, () => api.get(path));
  },
);

mcp.registerTool(
  "package_deps",
  {
    description:
      "Get the dependency graph for an npm or PyPI package: direct and transitive dependencies with versions and counts, with deprecated direct dependencies flagged.",
    inputSchema: {
      ecosystem: ecosystemSchema,
      name: nameSchema,
      version: z.string().optional().describe("Optional exact version; defaults to latest"),
    },
  },
  async ({ ecosystem, name, version }) => {
    const query = version ? `?version=${encodeURIComponent(version)}` : "";
    const path = `/v1/deps/${ecosystem}/${encodeURIComponent(name)}${query}`;
    return callApi(path, () => api.get(path));
  },
);

mcp.registerTool(
  "package_snapshot",
  {
    description:
      "Get a consolidated snapshot of an npm or PyPI package: latest version, license, description, repository, weekly downloads, maintainers, last publish date, and deprecation status.",
    inputSchema: { ecosystem: ecosystemSchema, name: nameSchema },
  },
  async ({ ecosystem, name }) => {
    const path = `/v1/package/${ecosystem}/${encodeURIComponent(name)}`;
    return callApi(path, () => api.get(path));
  },
);

mcp.registerTool(
  "package_downloads",
  {
    description: "Get download counts for an npm or PyPI package over a time range.",
    inputSchema: {
      ecosystem: ecosystemSchema,
      name: nameSchema,
      range: z
        .enum(["last-day", "last-week", "last-month", "last-year"])
        .optional()
        .describe("npm only; PyPI always returns last-week"),
    },
  },
  async ({ ecosystem, name, range }) => {
    const query = range ? `?range=${range}` : "";
    const path = `/v1/downloads/${ecosystem}/${encodeURIComponent(name)}${query}`;
    return callApi(path, () => api.get(path));
  },
);

mcp.registerTool(
  "package_batch_health",
  {
    description:
      "Score up to 50 packages in one call — use this to audit an entire package.json or requirements.txt at once instead of calling package_health repeatedly.",
    inputSchema: {
      queries: z
        .array(z.object({ ecosystem: ecosystemSchema, name: nameSchema }))
        .min(1)
        .max(50)
        .describe("Packages to score, max 50"),
    },
  },
  async ({ queries }) => callApi("/v1/batch", () => api.post("/v1/batch", { queries })),
);

const transport = new StdioServerTransport();
await mcp.connect(transport);
// stderr only: stdout is the MCP protocol channel and must not be polluted.
console.error(`package-intel MCP server ready (api=${baseURL}, payer=${account.address})`);
