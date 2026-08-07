# package-intel-mcp

Package and dependency intelligence for AI coding agents. Lets an agent check
whether an npm or PyPI package is maintained, popular, vulnerable, or deprecated
**before** it writes the dependency into your project.

Free, no account, no API key, no wallet. Data comes from the npm registry,
PyPI, [OSV.dev](https://osv.dev) and [deps.dev](https://deps.dev), consolidated
into one call so the agent doesn't have to stitch four APIs together.

## Install

```bash
claude mcp add package-intel -- npx -y package-intel-mcp
```

Or add it to `claude_desktop_config.json` / Cursor's `mcp.json` by hand:

```json
{
  "mcpServers": {
    "package-intel": {
      "command": "npx",
      "args": ["-y", "package-intel-mcp"]
    }
  }
}
```

That's the whole setup. No environment variables are required.

## Tools

| Tool | What it answers |
|---|---|
| `package_snapshot` | Latest version, license, repo, maintainers, last publish, deprecation |
| `package_vulns` | Known advisories from OSV, optionally scoped to one version |
| `package_deps` | Direct and transitive dependency graph, deprecated deps flagged |
| `package_downloads` | Download counts over a time range |

All four are free and read-only. Nothing about your code is transmitted — only
the package name you ask about.

## Making your agent use it automatically

Installing a tool doesn't mean an agent reaches for it. Adding a line to your
repo's `AGENTS.md` (or `CLAUDE.md`, or `.cursor/rules`) does:

```markdown
## Dependencies

Before adding or upgrading any npm or PyPI dependency, call `package_vulns`
and `package_snapshot` for it. Do not add a package that is deprecated, has
an unfixed critical advisory, or has not been published in over two years —
suggest a maintained alternative instead.
```

This matters more than it looks. Endor Labs found that only about 1 in 5
dependency versions recommended by AI coding assistants were safe to use, and
that giving the agent a tool to check with raised that from roughly 20% to 57%.

## Paid tier (optional)

One thing isn't free: a consolidated **0–100 health score** that combines
maintenance, popularity, security and freshness into a single verdict with a
rationale, plus batch scoring for a whole manifest at once. Those are paid
per call in USDC on Base via [x402](https://github.com/x402-foundation/x402).

To enable them, set a wallet key:

```json
{
  "mcpServers": {
    "package-intel": {
      "command": "npx",
      "args": ["-y", "package-intel-mcp"],
      "env": {
        "X402_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

Two extra tools appear: `package_health` ($0.01/call) and
`package_batch_health` ($0.02/call, up to 50 packages).

> **This is a hot key that spends automatically.** Use a dedicated wallet with a
> small balance, never your main one.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `API_URL` | `https://marketagent.adam121393.workers.dev` | Backing API |
| `NETWORK` | `eip155:8453` (Base mainnet) | CAIP-2 network for payments |
| `X402_PRIVATE_KEY` | *(unset)* | Enables the paid tools |

## Rate limits

Free endpoints allow 60 requests/minute and 2000/day per caller. Exceeding that
returns a `429` with a `Retry-After`; the tool surfaces it as a readable message
rather than a stack trace. Paid endpoints are not rate limited.

## Attribution

Data from the npm registry, PyPI, [OSV.dev](https://osv.dev) (Google/OpenSSF)
and [deps.dev](https://deps.dev) (Google Open Source Insights). This tool
consolidates and scores; it does not originate vulnerability data.
