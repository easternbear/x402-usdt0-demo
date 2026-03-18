import { config } from "dotenv";
import express from "express";
import cors from "cors";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { USDT0_ADDRESS, CHAIN_RPC, CHAIN_LABEL, CHAIN_ID, CHAIN_EXPLORER, WALLET_INDEX } from "../../x402/config.js";

config();

const PORT = process.env.DASHBOARD_PORT || 4030;
const MNEMONIC = process.env.MNEMONIC;
const LOG_PATH = new URL("./mcp-calls.json", import.meta.url).pathname;

if (!MNEMONIC) {
  console.error("MNEMONIC environment variable is required");
  process.exit(1);
}

const walletAccount = await new WalletManagerEvm(MNEMONIC, {
  provider: CHAIN_RPC,
}).getAccount(WALLET_INDEX);

const app = express();
app.use(cors());

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "dist");

app.get("/api/config", (req, res) => {
  res.json({
    chainLabel: CHAIN_LABEL,
    chainId: CHAIN_ID,
    explorer: CHAIN_EXPLORER,
  });
});

app.get("/api/balance", async (req, res) => {
  try {
    const raw = await walletAccount.getTokenBalance(USDT0_ADDRESS);
    const balance = Number(raw) / 1e6;
    res.json({ address: walletAccount.address, balance, raw: raw.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/calls", (req, res) => {
  try {
    if (!existsSync(LOG_PATH)) return res.json([]);
    const data = JSON.parse(readFileSync(LOG_PATH, "utf-8"));
    res.json(Array.isArray(data) ? data : []);
  } catch {
    res.json([]);
  }
});

if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("/{*splat}", (req, res) => {
    res.sendFile(join(distPath, "index.html"));
  });
}

// --- SSE listener: watch x402 server for settle_completed events and patch txHash into mcp-calls.json ---

const SERVER_URL = process.env.RESOURCE_SERVER_URL || "http://localhost:4021";

async function connectSSE() {
  try {
    const res = await fetch(`${SERVER_URL}/events`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "settle_completed" && data.details?.transactionHash) {
            const txHash = data.details.transactionHash;
            if (existsSync(LOG_PATH)) {
              const calls = JSON.parse(readFileSync(LOG_PATH, "utf-8"));
              if (Array.isArray(calls)) {
                for (let i = calls.length - 1; i >= 0; i--) {
                  if (calls[i].status === "success" && !calls[i].txHash) {
                    calls[i].txHash = txHash;
                    writeFileSync(LOG_PATH, JSON.stringify(calls, null, 2));
                    console.log(`Patched txHash ${txHash} into call #${i}`);
                    break;
                  }
                }
              }
            }
          }
        } catch {}
      }
    }
  } catch {
    setTimeout(connectSSE, 3000);
  }
}

app.listen(PORT, () => {
  console.log(`MCP Dashboard running on http://localhost:${PORT}`);
  console.log(`Chain: ${CHAIN_LABEL} (${CHAIN_ID})`);
  console.log(`Wallet: ${walletAccount.address}`);
  connectSSE();
  console.log(`SSE listener connected to ${SERVER_URL}/events`);
});