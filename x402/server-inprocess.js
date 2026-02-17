import { config } from "dotenv";
import express from "express";
import cors from "cors";
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme as registerFacilitatorScheme } from "@x402/evm/exact/facilitator";
import { x402ResourceServer, x402HTTPResourceServer } from "@x402/express";
import { ExactEvmScheme as ServerEvmScheme } from "@x402/evm/exact/server";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme as registerClientScheme } from "@x402/evm/exact/client";
import WalletAccountEvmX402Facilitator from "@semanticpay/wdk-wallet-evm-x402-facilitator";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { USDT0_ADDRESS, PLASMA_RPC, PLASMA_NETWORK, PRICE_UNITS } from "./config.js";
import { verifyFirstMiddleware } from "./middleware.js";

config();

const PORT = process.env.PORT || 4021;
const MNEMONIC = process.env.MNEMONIC;
const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS;

if (!MNEMONIC) {
  console.error("MNEMONIC environment variable is required");
  process.exit(1);
}

if (!PAY_TO_ADDRESS) {
  console.error("PAY_TO_ADDRESS environment variable is required");
  process.exit(1);
}

const sseClients = new Set();

function broadcastEvent(type, data = {}) {
  const event = { type, timestamp: Date.now(), ...data };
  const message = `data: ${JSON.stringify(event)}\n\n`;
  sseClients.forEach((client) => client.write(message));
}

const walletAccount = await new WalletManagerEvm(MNEMONIC, {
  provider: PLASMA_RPC,
}).getAccount();

const evmSigner = new WalletAccountEvmX402Facilitator(walletAccount);

const facilitator = new x402Facilitator()
  .onBeforeVerify(async (context) => {
    broadcastEvent("verify_started", {
      step: 6,
      title: "Payment Verification Started",
      description: "Facilitator is verifying the payment signature and requirements",
      details: {
        network: context.requirements?.network,
        checks: ["Signature validity", "Signer balance", "Nonce uniqueness", "Valid time window"],
      },
      actor: "facilitator",
    });
  })
  .onAfterVerify(async (context) => {
    broadcastEvent("verify_completed", {
      step: 7,
      title: "Payment Verified",
      description: context.result?.isValid
        ? "Payment signature and requirements verified successfully"
        : "Payment verification failed",
      details: {
        isValid: context.result?.isValid,
        network: context.requirements?.network,
      },
      actor: "facilitator",
    });
  })
  .onVerifyFailure(async (context) => {
    broadcastEvent("verify_failed", {
      step: 7,
      title: "Verification Failed",
      description: `Payment verification failed: ${context.error?.message}`,
      details: { error: context.error?.message },
      actor: "facilitator",
      isError: true,
    });
  })
  .onBeforeSettle(async (context) => {
    broadcastEvent("settle_started", {
      step: 9,
      title: "On-Chain Settlement Started",
      description: "Broadcasting receiveWithAuthorization transaction to Plasma blockchain",
      details: {
        contract: `USDT0 (${USDT0_ADDRESS.slice(0, 6)}...${USDT0_ADDRESS.slice(-4)})`,
        method: "receiveWithAuthorization",
        chain: "Plasma (chainId: 9745)",
        network: context.requirements?.network,
      },
      actor: "facilitator",
      target: "blockchain",
    });
  })
  .onAfterSettle(async (context) => {
    const txHash = context.result?.transaction;
    broadcastEvent("settle_completed", {
      step: 10,
      title: "Settlement Confirmed",
      description: "Payment transaction confirmed on Plasma blockchain",
      details: {
        success: context.result?.success,
        transactionHash: txHash,
        explorerUrl: txHash ? `https://explorer.plasma.to/tx/${txHash}` : null,
        network: context.requirements?.network,
      },
      actor: "blockchain",
      target: "facilitator",
    });
  })
  .onSettleFailure(async (context) => {
    broadcastEvent("settle_failed", {
      step: 10,
      title: "Settlement Failed",
      description: `On-chain settlement failed: ${context.error?.message}`,
      details: { error: context.error?.message },
      actor: "facilitator",
      isError: true,
    });
  });

registerFacilitatorScheme(facilitator, {
  signer: evmSigner,
  networks: PLASMA_NETWORK,
});

const resourceServer = new x402ResourceServer(facilitator).register(
  PLASMA_NETWORK,
  new ServerEvmScheme()
);

const routes = {
  "GET /weather": {
    accepts: [
      {
        scheme: "exact",
        network: PLASMA_NETWORK,
        price: {
          amount: PRICE_UNITS,
          asset: USDT0_ADDRESS,
          extra: { name: "USDT0", version: "1", decimals: 6 },
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

const app = express();
app.use(cors());
app.use(verifyFirstMiddleware(httpServer, initPromiseHolder));

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
    const initial402 = await fetch(weatherUrl);

    if (initial402.status === 402) {
      broadcastEvent("payment_required", {
        step: 2,
        title: "402 Payment Required",
        description: "Server responded with payment requirements",
        details: {
          status: 402,
          price: "0.0001 USDT0 (100 units)",
          payTo: PAY_TO_ADDRESS,
          network: "Plasma (eip155:9745)",
          scheme: "exact",
        },
        actor: "server",
        target: "client",
      });

      await sleep(300);

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

    const response = await wrappedFetch(weatherUrl, { method: "GET" });
    const body = await response.json();

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
      facilitator: "in-process",
      address: walletAccount.address,
      payTo: PAY_TO_ADDRESS,
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
    chain: "plasma",
    chainId: 9745,
    facilitator: walletAccount.address,
    payTo: PAY_TO_ADDRESS,
  });
});

app.listen(PORT, () => {
  console.log(`x402 server running on http://localhost:${PORT}`);
  console.log(`Network: ${PLASMA_NETWORK}`);
  console.log(`USDT0: ${USDT0_ADDRESS}`);
  console.log(`Facilitator: in-process (${walletAccount.address})`);
  console.log(`Pay to: ${PAY_TO_ADDRESS}`);
});
