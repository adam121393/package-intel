
- # TASK: Implement Agentic Payments (x402) for an MCP Server

## 1. Project Context
You are updating a Node.js-based MCP (Model Context Protocol) server named `package-intel-mcp`. This server provides AI agents with software supply-chain intelligence (npm, PyPI, crates.io). 

Currently, all tools are free. The goal is to implement an agent-native microtransaction layer using the x402 protocol pattern (HTTP 402 Payment Required). 

## 2. Business Logic Mapping
We are splitting the existing tools into two tiers:
*   **Free Tools:** `get_version`, `get_basic_metadata`
*   **Paid Tools:** `scan_vulnerabilities`, `get_deep_dependencies`

The price for paid tools will be denominated in **USDC on the Base network** (e.g., 0.05 USDC per call). 

## 3. The Implementation Flow
Do not break the standard MCP protocol. Instead, implement a tool-call interceptor that handles the payment challenge.

1.  **The Interceptor:** When the agent calls a paid tool (e.g., `scan_vulnerabilities`), intercept the request.
2.  **The Challenge:** If no payment proof (Transaction Hash) is provided in the tool's arguments, return an MCP `CallToolResult` formatted as an x402 challenge.
    *   *Message:* "Payment Required. Please send [Amount] USDC on Base to [Merchant_Wallet]. Retry this tool call with the argument `tx_hash` containing the transaction hash."
3.  **The Verification:** When the agent retries the call and provides a `tx_hash`, use `ethers.js` or `viem` to verify that the transaction:
    *   Is on the Base network.
    *   Sent the correct USDC amount to the correct Merchant Wallet.
    *   Is fully confirmed.
4.  **The Execution:** If the `tx_hash` is valid and hasn't been used before, execute the actual tool logic and return the supply-chain data.

## 4. Required Updates & Steps for the Agent

**Step 1: Install Dependencies**
Install `ethers` (or `viem`) to verify blockchain transactions on the Base network.
`npm install ethers`

**Step 2: Environment Configuration**
Add the following to `.env`:
*   `MERCHANT_WALLET_ADDRESS` (The wallet receiving the USDC)
*   `BASE_RPC_URL` (Public RPC URL for Base)
*   `USDC_CONTRACT_ADDRESS` (The contract address for USDC on Base)

**Step 3: Update Tool Schemas**
Update the schemas for all "Paid Tools" to include an optional `tx_hash` argument.
```json
{
  "name": "tx_hash",
  "type": "string",
  "description": "The transaction hash of your USDC payment on Base network (Required for execution)"
}