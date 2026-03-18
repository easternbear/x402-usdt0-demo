# x402-usdt0-demo

A working demo of the [x402 payment protocol](https://x402.org) on [Stable](https://stable.xyz) blockchain using USDT0 and the [WDK (Wallet Development Kit)](https://docs.wallet.tether.io). Includes an HTTP payment flow visualization and an MCP integration for Claude Desktop.

Supports both **Stable Testnet** (in-process facilitator) and **Stable Mainnet** (external [SemanticPay](https://docs.semanticpay.io) facilitator).

## About x402

x402 is a payment protocol built on the HTTP 402 (Payment Required) status code. It enables **pay-per-request** access to web APIs using on-chain USDT0 transfers, without requiring accounts, subscriptions, or API keys.

### Actors

| Actor | Role |
|-------|------|
| **Client** | Requests a protected resource. On receiving a 402 response, signs an EIP-3009 `TransferWithAuthorization` and retries with the signed payment attached. |
| **Resource Server** | Serves protected endpoints. Returns 402 with payment requirements when no valid payment is present. Once payment is verified, serves the resource. |
| **Facilitator** | Verifies payment signatures and settles on-chain. Can run **in-process** (embedded in the server) or as an **external service** (e.g. SemanticPay). The facilitator pays the gas fees for on-chain settlement. |

### Payment Flow (Verify-First Pattern)

```
Client                    Server                  Facilitator            Blockchain
  |                         |                         |                      |
  |  1. GET /weather        |                         |                      |
  |------------------------>|                         |                      |
  |                         |                         |                      |
  |  2. 402 Payment Required|                         |                      |
  |<------------------------|                         |                      |
  |  (price, asset, payTo)  |                         |                      |
  |                         |                         |                      |
  |  3-4. Sign EIP-3009     |                         |                      |
  |  (off-chain, no gas)    |                         |                      |
  |                         |                         |                      |
  |  5. GET /weather + sig  |                         |                      |
  |------------------------>|                         |                      |
  |                         |  6. POST /verify        |                      |
  |                         |------------------------>|                      |
  |                         |  7. { isValid: true }   |                      |
  |                         |<------------------------|                      |
  |                         |                         |                      |
  |  8. 200 OK + data       |                         |                      |
  |<------------------------|                         |                      |
  |                         |                         |                      |
  |    (client done)        |  9. POST /settle (async)|                      |
  |                         |------------------------>|                      |
  |                         |                         | 10. receiveWithAuth  |
  |                         |                         |--------------------->|
  |                         |                         |  tx confirmed        |
  |                         |                         |<---------------------|
```

The server uses a **verify-first** pattern: it verifies the payment signature and responds immediately (Step 8), then settles on-chain asynchronously (Steps 9-10). The client never waits for blockchain confirmation.

## Architecture

### HTTP Demo

Two execution modes are available:

**Testnet (In-Process Facilitator)**
```
Browser (:5173)  <--SSE-->  Server + Facilitator (:4021)  -->  Stable Testnet (2201)
                            [server-inprocess.js]
```

**Mainnet (External Facilitator)**
```
Browser (:5173)  <--SSE-->  Resource Server (:4021)  --HTTP-->  SemanticPay Facilitator  -->  Stable Mainnet (988)
                            [server.js]                         [x402.semanticpay.io]
```

### MCP Demo

```
Claude Desktop  <--stdio-->  MCP Server         --HTTP-->  x402 Server (:4021)  -->  Blockchain
                              [mcp/server.js]               [server*.js]

Dashboard (:4030)  <--reads-->  mcp-calls.json
[mcp/dashboard.js]
```

When Claude calls the `get-weather` tool:
1. MCP Server sends `GET /weather` to the x402 server
2. Receives 402, automatically signs EIP-3009 payment, retries
3. Returns weather data to Claude
4. Logs the call (including txHash) to `mcp-calls.json`
5. Dashboard displays balance, call history, and explorer links

## Prerequisites

- **Node.js** v20+
- **BIP-39 Mnemonic**: HD wallet seed phrase. Generate a new one or export from MetaMask.
- **USDT0 balance**: The derived wallet must hold USDT0.
  - Testnet: Get free tokens from [faucet.stable.xyz](https://faucet.stable.xyz)
  - Mainnet: Bridge USDT via [usdt0.to/transfer](https://usdt0.to/transfer)
- **Pay-to address**: An Ethereum address (0x...) to receive payments (PAY_TO_ADDRESS).

### Wallet Index

This project uses WDK to derive wallets from BIP-44 path `m/44'/60'/0'/0/{index}`. Testnet defaults to index 0, mainnet to index 2. Adjust `WALLET_INDEX` in `x402/config.js` to match the index that holds your USDT0 balance.

```bash
# Check wallet address
NETWORK_MODE=testnet node -e "
import WalletManagerEvm from '@tetherto/wdk-wallet-evm';
import { CHAIN_RPC, WALLET_INDEX } from './x402/config.js';
import { config } from 'dotenv'; config();
const a = await new WalletManagerEvm(process.env.MNEMONIC, { provider: CHAIN_RPC }).getAccount(WALLET_INDEX);
console.log('Address:', a.address);
"
```

## Quick Start

### 1. Install

```bash
npm install
npm install --prefix demo/http
npm install --prefix demo/mcp
```

### 2. Configure

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `MNEMONIC` | BIP-39 mnemonic seed phrase. |
| `PAY_TO_ADDRESS` | Ethereum address (0x...) to receive payments. |
| `FACILITATOR_URL` | External facilitator URL. Required for mainnet. Use `https://x402.semanticpay.io`. |

### 3. Run

| Command | Network | Facilitator | Description |
|---------|---------|-------------|-------------|
| `npm run demo:http:testnet` | Stable Testnet (2201) | In-process | HTTP demo with local facilitator |
| `npm run demo:http:mainnet` | Stable Mainnet (988) | SemanticPay | HTTP demo with external facilitator |
| `npm run demo:mcp:testnet` | Stable Testnet (2201) | In-process | MCP demo + dashboard |
| `npm run demo:mcp:mainnet` | Stable Mainnet (988) | SemanticPay | MCP demo + dashboard |

**HTTP Demo**: Open http://localhost:5173 and click "Access Weather App" to trigger a real payment flow.

**MCP Demo**: Open http://localhost:4030 for the dashboard. Ask Claude Desktop to "get the weather".

## MCP Setup (Claude Desktop)

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "x402-weather": {
      "command": "node",
      "args": ["<absolute-path-to-repo>/demo/mcp/server.js"],
      "env": {
        "MNEMONIC": "<your mnemonic>",
        "RESOURCE_SERVER_URL": "http://localhost:4021",
        "CHAIN_RPC": "https://rpc.stable.xyz",
        "WALLET_INDEX": "2"
      }
    }
  }
}
```

For testnet, change `CHAIN_RPC` to `https://rpc.testnet.stable.xyz` and `WALLET_INDEX` to `"0"`.

Restart Claude Desktop after editing the config.

## Network Configuration

The network is selected via `NETWORK_MODE` environment variable (set automatically by npm scripts).

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | 2201 | 988 |
| Network | `eip155:2201` | `eip155:988` |
| RPC | `https://rpc.testnet.stable.xyz` | `https://rpc.stable.xyz` |
| USDT0 | `0x78Cf2437...` | `0x779Ded0c...` |
| EIP-712 Domain Name | `USD₮0` | `USDT0` |
| Explorer | [testnet.stablescan.xyz](https://testnet.stablescan.xyz) | [stablescan.xyz](https://stablescan.xyz) |
| Wallet Index | 0 | 2 |
| Faucet | [faucet.stable.xyz](https://faucet.stable.xyz) | N/A (real tokens) |
| Facilitator | In-process only | [x402.semanticpay.io](https://x402.semanticpay.io) |
| Payment | 0.0001 USDT0 per request | 0.0001 USDT0 per request |

## Project Structure

```
x402/
  config.js              Network config (testnet/mainnet) selected by NETWORK_MODE
  middleware.js           Verify-first payment middleware with logging
  server.js              Resource server with external facilitator (mainnet)
  server-inprocess.js    Resource server with in-process facilitator (testnet)
  client.js              CLI client for testing paid requests

demo/
  http/                  Payment flow visualization (React + Vite, :5173)
    src/App.jsx          Timeline UI with dynamic architecture diagram
  mcp/
    server.js            MCP stdio server (get-weather tool) for Claude Desktop
    dashboard.js         Express API for balance, call history, chain config
    src/App.jsx          Dashboard UI (balance, call history with explorer links)
```

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
