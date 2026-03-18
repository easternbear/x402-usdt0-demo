import { config } from "dotenv";
import express from "express";
import cors from "cors";
import { x402ResourceServer, x402HTTPResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme as registerClientScheme } from "@x402/evm/exact/client";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { USDT0_ADDRESS, CHAIN_RPC, CHAIN_NETWORK, CHAIN_EXPLORER, CHAIN_LABEL, CHAIN_ID, USDT0_DOMAIN_NAME, WALLET_INDEX, PRICE_UNITS, NETWORK_MODE } from "./config.js";
import { verifyFirstMiddleware } from "./middleware.js";

config();

const PORT = process.env.PORT || 4021;
const MNEMONIC = process.env.MNEMONIC;
const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS;
const FACILITATOR_URL = process.env.FACILITATOR_URL;

if (!MNEMONIC) {
  console.error("MNEMONIC environment variable is required");
  process.exit(1);
}

if (!PAY_TO_ADDRESS) {
  console.error("PAY_TO_ADDRESS environment variable is required");
  process.exit(1);
}

if (!FACILITATOR_URL) {
  console.error("FACILITATOR_URL environment variable is required");
  process.exit(1);
}

// --- SSE infrastructure ---

const sseClients = new Set();

function broadcastEvent(type, data = {}) {
  const event = { type, timestamp: Date.now(), ...data };
  const message = `data: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach((client) => client.write(message));
}

// --- Wallet (for the demo client that initiates paid requests) ---

const walletAccount = await new WalletManagerEvm(MNEMONIC, {
  provider: CHAIN_RPC,
}).getAccount(WALLET_INDEX);

// --- External facilitator client ---

// --- Logging helper ---
const log = (tag, ...args) => console.log(`[${new Date().toISOString()}] [${tag}]`, ...args);

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

const resourceServer = new x402ResourceServer(facilitatorClient).register(
  CHAIN_NETWORK,
  new ExactEvmScheme()
);

const routes = {
  "GET /weather": {
    accepts: [
      {
        scheme: "exact",
        network: CHAIN_NETWORK,
        price: {
          amount: PRICE_UNITS,
          asset: USDT0_ADDRESS,
          extra: { name: USDT0_DOMAIN_NAME, version: "1", decimals: 6 },
        },
        payTo: PAY_TO_ADDRESS,
      },
    ],
    description: "Weather data",
    mimeType: "application/json",
  },
};

const httpServer = new x402HTTPResourceServer(resourceServer, routes);
const initPromiseHolder = { promise: httpServer.initialize() };

// --- Express app ---

const app = express();
app.use(cors());
app.use(express.json());
app.use(verifyFirstMiddleware(httpServer, initPromiseHolder, { onEvent: broadcastEvent }));

app.get("/weather", (req, res) => {
  res.json({
    report: {
      weather: "sunny",
      temperature: 70,
      location: "San Francisco",
      timestamp: new Date().toISOString(),
    },
  });
});

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  res.write(`data: ${JSON.stringify({ type: "connected", timestamp: Date.now() })}\n\n`);

  sseClients.add(res);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.post("/demo/start-flow", async (req, res) => {
  broadcastEvent("flow_reset");

  try {
    log("CLIENT", `Step 1: GET /weather (signer: ${walletAccount.address})  [server.js:126]`);
    broadcastEvent("request_initiated", {
      step: 1,
      title: "Request Initiated",
      description: "Client sends GET request to /weather endpoint",
      details: {
        method: "GET",
        url: `http://localhost:${PORT}/weather`,
        signer: walletAccount.address,
      },
      actor: "client",
      target: "server",
    });

    await sleep(300);

    const weatherUrl = `http://localhost:${PORT}/weather`;
    log("CLIENT", "Sending bare GET /weather (no payment)...  [server.js:141]");
    const initial402 = await fetch(weatherUrl);
    log("CLIENT", `Response: ${initial402.status}  [server.js:143]`);

    if (initial402.status === 402) {
      log("CLIENT", "Step 2: Received 402 Payment Required  [server.js:146]");
      broadcastEvent("payment_required", {
        step: 2,
        title: "402 Payment Required",
        description: "Server responded with payment requirements",
        details: {
          status: 402,
          price: "0.0001 USDT0 (100 units)",
          payTo: PAY_TO_ADDRESS,
          network: `${CHAIN_LABEL} (${CHAIN_NETWORK})`,
          scheme: "exact",
        },
        actor: "server",
        target: "client",
      });

      await sleep(300);

      log("CLIENT", "Step 3: Signing EIP-3009 TransferWithAuthorization...");
      broadcastEvent("payment_signing", {
        step: 3,
        title: "Signing Payment Authorization",
        description: "Creating EIP-3009 TransferWithAuthorization signature",
        details: {
          signer: walletAccount.address,
          to: PAY_TO_ADDRESS,
          amount: "100 units (0.0001 USDT0)",
          method: "EIP-712 Typed Data Signature",
        },
        actor: "client",
      });

      await sleep(400);

      log("CLIENT", "Step 4: Signature created");
      broadcastEvent("payment_signed", {
        step: 4,
        title: "Payment Signed",
        description: "EIP-712 typed data signature created successfully",
        details: {
          signerAddress: walletAccount.address,
          signatureType: "TransferWithAuthorization",
        },
        actor: "client",
      });

      await sleep(200);

      log("CLIENT", "Step 5: Retrying GET /weather with payment signature...");
      broadcastEvent("request_with_payment", {
        step: 5,
        title: "Request with Payment Payload",
        description: "Retrying request with signed payment attached",
        details: {
          method: "GET",
          url: weatherUrl,
          paymentHeader: "payment-signature",
        },
        actor: "client",
        target: "server",
      });

      await sleep(200);
    }

    const client = new x402Client();
    registerClientScheme(client, { signer: walletAccount });
    const wrappedFetch = wrapFetchWithPayment(fetch, client);

    log("CLIENT", "Sending paid GET /weather via wrapFetchWithPayment...");
    const response = await wrappedFetch(weatherUrl, { method: "GET" });
    const body = await response.json();
    log("CLIENT", `Step 8: Response ${response.status}`, response.ok ? "OK" : "FAILED");

    if (response.ok) {
      broadcastEvent("response_received", {
        step: 8,
        title: "Weather Data Received",
        description: "Client received protected resource after successful verification",
        details: {
          status: response.status,
          weatherData: body,
        },
        actor: "server",
        target: "client",
      });

      res.json({ success: true, weatherData: body });
    } else {
      broadcastEvent("flow_error", {
        title: "Request Failed",
        description: `Request failed with status ${response.status}`,
        details: { status: response.status, body },
        isError: true,
      });

      res.json({ success: false, status: response.status, body });
    }
  } catch (error) {
    console.error("Flow error:", error);
    broadcastEvent("flow_error", {
      title: "Flow Error",
      description: error.message,
      details: {
        error: error.message,
        stack: error.stack?.split("\n").slice(0, 3),
      },
      isError: true,
    });

    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/demo/status", (req, res) => {
  res.json({
    server: {
      status: "running",
      port: PORT,
      facilitator: `external (${FACILITATOR_URL})`,
      address: walletAccount.address,
      payTo: PAY_TO_ADDRESS,
      chainLabel: CHAIN_LABEL,
      chainId: CHAIN_ID,
      network: CHAIN_NETWORK,
      explorer: CHAIN_EXPLORER,
    },
    connectedClients: sseClients.size,
  });
});

app.post("/demo/reset", (req, res) => {
  broadcastEvent("flow_reset");
  res.json({ success: true });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    chain: CHAIN_LABEL,
    chainId: CHAIN_ID,
    facilitator: FACILITATOR_URL,
    payTo: PAY_TO_ADDRESS,
  });
});

app.listen(PORT, () => {
  console.log(`x402 server running on http://localhost:${PORT}`);
  console.log(`Network: ${CHAIN_NETWORK}`);
  console.log(`USDT0: ${USDT0_ADDRESS}`);
  console.log(`Facilitator: ${FACILITATOR_URL}`);
  console.log(`Pay to: ${PAY_TO_ADDRESS}`);
});
