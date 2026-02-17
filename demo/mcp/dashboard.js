import { config } from "dotenv";
import express from "express";
import cors from "cors";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";

config();

const PORT = process.env.DASHBOARD_PORT || 4030;
const MNEMONIC = process.env.MNEMONIC;
const USDT0_ADDRESS = "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb";
const LOG_PATH = new URL("./mcp-calls.json", import.meta.url).pathname;

if (!MNEMONIC) {
  console.error("MNEMONIC environment variable is required");
  process.exit(1);
}

const walletAccount = await new WalletManagerEvm(MNEMONIC, {
  provider: "https://rpc.plasma.to",
}).getAccount();

const app = express();
app.use(cors());

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, "dist");

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

app.listen(PORT, () => {
  console.log(`MCP Dashboard running on http://localhost:${PORT}`);
  console.log(`Wallet: ${walletAccount.address}`);
});
