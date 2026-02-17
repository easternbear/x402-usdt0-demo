# x402-usdt0-demo

A working demo of the [x402 payment protocol](https://x402.org) on [Plasma](https://plasma.to) blockchain using USDT0 and the [WDK (Wallet Development Kit)](https://docs.wallet.tether.io). Includes an HTTP payment flow visualization and an MCP integration for Claude Desktop.

## About x402

x402 is a payment protocol built on the HTTP 402 (Payment Required) status code. It enables pay-per-request access to web APIs using on-chain token transfers, without requiring accounts, subscriptions, or API keys.

### Actors

The protocol has three actors:

| Actor | Role |
|-------|------|
| **Client** | Requests a protected resource. On receiving a 402 response, signs an EIP-3009 `TransferWithAuthorization` and retries with the signed payment attached. |
| **Resource Server** | Serves protected endpoints. Returns 402 with payment requirements when no valid payment is present. Once payment is verified, serves the resource. |
| **Facilitator** | Verifies payment signatures and settles on-chain. Can run in-process (embedded in the server) or as a standalone service. |

### Payment Flow

```
Client                    Server (+ Facilitator)           Blockchain
  |                              |                             |
  |  1. GET /weather             |                             |
  |----------------------------->|                             |
  |                              |                             |
  |  2. 402 Payment Required     |                             |
  |<-----------------------------|                             |
  |  (price, asset, payTo, net)  |                             |
  |                              |                             |
  |  3. Sign EIP-3009 payload    |                             |
  |  (TransferWithAuthorization) |                             |
  |                              |                             |
  |  4. GET /weather + signature |                             |
  |----------------------------->|                             |
  |                              |                             |
  |             5. Verify signature, balance, nonce            |
  |                              |                             |
  |  6. 200 OK + weather data    |                             |
  |<-----------------------------|                             |
  |                              |                             |
  |              7. Settle (async): receiveWithAuthorization   |
  |                              |---------------------------->|
  |                              |                             |
  |                              |  8. Transaction confirmed   |
  |                              |<----------------------------|
```

The server uses a **verify-first** pattern: it verifies the payment and responds immediately, then settles on-chain asynchronously after the response is sent. This avoids making the client wait for blockchain confirmation.

## About WDK

This project uses [WDK (Wallet Development Kit)](https://docs.wallet.tether.io) for all wallet operations instead of viem or ethers.

### @tetherto/wdk-wallet-evm

Provides BIP-39/BIP-44 wallet management for EVM chains. Used in this project for:

- Deriving wallet accounts from a mnemonic seed phrase
- Signing EIP-712 typed data (for x402 payment authorization)
- Querying ERC-20 token balances (USDT0 on Plasma)

```js
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";

const walletAccount = await new WalletManagerEvm(mnemonic, {
  provider: "https://rpc.plasma.to",
}).getAccount();

console.log(walletAccount.address);

const balance = await walletAccount.getTokenBalance("0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb");
console.log(Number(balance) / 1e6, "USDT0");
```

For detailed documentation about the WDK ecosystem, visit [docs.wallet.tether.io](https://docs.wallet.tether.io).

### @semanticpay/wdk-wallet-evm-x402-facilitator

Bridges WDK wallets to the x402 facilitator signer interface. Wraps a `WalletAccountEvm` so it can be passed to x402's `registerExactEvmScheme` as a facilitator signer:

```js
import WalletAccountEvmX402Facilitator from "@semanticpay/wdk-wallet-evm-x402-facilitator";

const evmSigner = new WalletAccountEvmX402Facilitator(walletAccount);

registerFacilitatorScheme(facilitator, {
  signer: evmSigner,
  networks: "eip155:9745",
});
```

The adapter provides `readContract`, `writeContract`, `verifyTypedData`, `sendTransaction`, and `waitForTransactionReceipt` — everything x402's EVM facilitator needs to verify and settle payments.

## How the Demo Works

### External Facilitator (Default)

The resource server (`x402/server.js`) connects to an external facilitator service via HTTP. The facilitator (`x402/facilitator.js`) runs as a standalone service and pushes lifecycle events back to the resource server for SSE broadcasting:

### In-Process Facilitator

Both the resource server and facilitator run in a single process (`x402/server-inprocess.js`). The facilitator is created with lifecycle hooks that broadcast Server-Sent Events (SSE) to connected clients:

```
onBeforeVerify  → SSE: verify_started
onAfterVerify   → SSE: verify_completed
onBeforeSettle  → SSE: settle_started
onAfterSettle   → SSE: settle_completed
```

### Verify-First Middleware

The custom middleware in `x402/middleware.js` replaces the standard `paymentMiddleware` from `@x402/express`. It:

1. Calls `httpServer.processHTTPRequest()` to verify the payment
2. If verified, hooks into `res.on("finish")` to trigger settlement after the response is sent
3. Calls `next()` to let the route handler send the response immediately
4. Settlement runs asynchronously via `httpServer.processSettlement()`

### HTTP Demo

The React UI at `demo/http/` connects to the server's SSE endpoint and renders each step of the payment flow in real time as it happens — from the initial 402 response through signature creation, verification, response delivery, and on-chain settlement.

### MCP Demo

The MCP server at `demo/mcp/server.js` is a stdio-based MCP tool server for Claude Desktop. When Claude calls the `get-weather` tool:

1. It makes a paid request to the x402 server using `@x402/fetch`
2. The payment is signed automatically using the WDK wallet
3. The tool call is logged to `mcp-calls.json`
4. The React dashboard at `demo/mcp/` shows the wallet balance and call history

## Quick Start

```bash
npm install
npm run setup
```

The setup wizard will:
- Ask for your environment variables (MNEMONIC, PAY_TO_ADDRESS)
- Create the `.env` file
- Start the required servers
- For MCP: configure Claude Desktop and open the dashboard

## Manual Setup

Copy the environment file and fill in your credentials:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `MNEMONIC` | BIP-39 mnemonic seed phrase. The derived account must have USDT0 balance on Plasma. |
| `PAY_TO_ADDRESS` | Ethereum address (0x...) to receive payments. |
| `FACILITATOR_URL` | Facilitator service URL. Use `https://x402.semanticpay.io` for the hosted Semantic facilitator or `http://localhost:4022` for self-hosted. |

## HTTP Demo

Visualizes the full x402 payment flow in the browser with real on-chain transactions.

```bash
npm run demo:http
```

This starts the facilitator on :4022, the x402 server on :4021, and the React UI on :5173. Open http://localhost:5173 and click "Access Weather App" to trigger a real payment. Each request costs 0.0001 USDT0.

To use the Semantic hosted facilitator instead of running your own, set `FACILITATOR_URL=https://x402.semanticpay.io` in your `.env` and use:

```bash
npm run demo:http
```

The server will connect to the Semantic facilitator — no need to run facilitator.js locally.

## MCP Demo

Connects Claude Desktop to an x402-protected weather endpoint via MCP.

### 1. Start the server and dashboard

```bash
npm run demo:mcp
```

This builds the React dashboard, then starts the facilitator on :4022, the x402 server on :4021, and the dashboard on :4030.

### 2. Configure Claude Desktop

Add to your Claude Desktop config:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "x402-weather": {
      "command": "node",
      "args": ["<absolute-path-to-repo>/demo/mcp/server.js"],
      "env": {
        "MNEMONIC": "<your mnemonic>",
        "RESOURCE_SERVER_URL": "http://localhost:4021"
      }
    }
  }
}
```

If the file already has other `mcpServers` entries, add `x402-weather` alongside them. The setup wizard (`npm run setup`) handles this merge automatically.

### 3. Use it

Restart Claude Desktop and ask it to "get the weather". Each tool call costs 0.0001 USDT0. View call history and balance at http://localhost:4030.

## Project Structure

```
x402/
  config.js              Shared constants (USDT0 address, RPC URL, network ID, price)
  middleware.js           Verify-first payment middleware
  server.js              Resource server using an external facilitator via HTTP (default)
  server-inprocess.js    Resource server with in-process facilitator and SSE events
  facilitator.js         Standalone facilitator service with SSE event forwarding
  client.js              CLI client that makes a paid request

demo/
  http/                  Payment flow visualization (React + Vite, port 5173)
    src/App.jsx          Timeline UI connected to SSE events
  mcp/
    server.js            MCP stdio server (get-weather tool) for Claude Desktop
    dashboard.js         Express API for wallet balance and call history
    src/App.jsx          React dashboard (balance card, call history table)

bin/
  setup.js               Interactive setup wizard
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run setup` | Interactive setup wizard (creates .env, starts servers, configures Claude Desktop) |
| `npm run demo:http` | Start facilitator, x402 server, and HTTP demo UI |
| `npm run demo:http-inprocess` | Start x402 server (in-process facilitator) and HTTP demo UI |
| `npm run demo:mcp` | Build dashboard, start facilitator, x402 server, and MCP dashboard |
| `npm run demo:mcp-inprocess` | Build dashboard, start x402 server (in-process facilitator) and MCP dashboard |

## Network

| | |
|---|---|
| Chain | Plasma (chainId 9745) |
| RPC | https://rpc.plasma.to |
| USDT0 | `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb` |
| Explorer | https://explorer.plasma.to |
| Payment amount | 0.0001 USDT0 (100 base units) per request |

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `@x402/core` | x402 protocol core — Client, ResourceServer, Facilitator |
| `@x402/express` | Express adapter, HTTPResourceServer, payment middleware |
| `@x402/fetch` | Fetch wrapper that handles 402 responses automatically |
| `@x402/evm` | EVM payment scheme (EIP-3009 TransferWithAuthorization) |
| `@tetherto/wdk-wallet-evm` | BIP-39/BIP-44 EVM wallet management (signing, balances) |
| `@semanticpay/wdk-wallet-evm-x402-facilitator` | Adapter bridging WDK wallets to x402 facilitator signer interface |
| `@modelcontextprotocol/sdk` | MCP server SDK for Claude Desktop integration |
