import { config } from "dotenv";
import { AsyncLocalStorage } from "node:async_hooks";
import express from "express";
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import WalletAccountEvmX402Facilitator from "@semanticpay/wdk-wallet-evm-x402-facilitator";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { USDT0_ADDRESS, PLASMA_RPC, PLASMA_NETWORK } from "./config.js";

config();

const PORT = process.env.PORT || 4022;
const MNEMONIC = process.env.MNEMONIC;

if (!MNEMONIC) {
  console.error("MNEMONIC environment variable is required");
  process.exit(1);
}

const walletAccount = await new WalletManagerEvm(MNEMONIC, {
  provider: PLASMA_RPC,
}).getAccount();

const evmSigner = new WalletAccountEvmX402Facilitator(walletAccount);

// --- Lifecycle event callback via X-Event-Callback header ---
// The resource server sends X-Event-Callback header with each /verify and /settle request.
// AsyncLocalStorage threads the callback URL into lifecycle hooks without global state.

const callbackStore = new AsyncLocalStorage();

function pushEvent(payload) {
  const callbackUrl = callbackStore.getStore();
  if (!callbackUrl) return;
  fetch(callbackUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

const facilitator = new x402Facilitator()
  .onBeforeVerify(async (context) => {
    console.log("Before verify:", context.requirements?.network);
    pushEvent({
      type: "verify_started",
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
    console.log("After verify - valid:", context.result?.isValid);
    pushEvent({
      type: "verify_completed",
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
    console.log("Verify failure:", context.error);
    pushEvent({
      type: "verify_failed",
      step: 7,
      title: "Verification Failed",
      description: `Payment verification failed: ${context.error?.message}`,
      details: { error: context.error?.message },
      actor: "facilitator",
      isError: true,
    });
  })
  .onBeforeSettle(async (context) => {
    console.log("Before settle:", context.requirements?.network);
    pushEvent({
      type: "settle_started",
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
    console.log("After settle - success:", context.result?.success);
    if (txHash) {
      console.log("Transaction:", txHash);
    }
    pushEvent({
      type: "settle_completed",
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
    console.log("Settle failure:", context.error);
    pushEvent({
      type: "settle_failed",
      step: 10,
      title: "Settlement Failed",
      description: `On-chain settlement failed: ${context.error?.message}`,
      details: { error: context.error?.message },
      actor: "facilitator",
      isError: true,
    });
  });

registerExactEvmScheme(facilitator, {
  signer: evmSigner,
  networks: PLASMA_NETWORK,
});

const app = express();
app.use(express.json());

app.post("/verify", async (req, res) => {
  const callbackUrl = req.headers["x-event-callback"];
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const response = await callbackStore.run(callbackUrl, () =>
      facilitator.verify(paymentPayload, paymentRequirements)
    );
    res.json(response);
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/settle", async (req, res) => {
  const callbackUrl = req.headers["x-event-callback"];
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
    }
    const response = await callbackStore.run(callbackUrl, () =>
      facilitator.settle(paymentPayload, paymentRequirements)
    );
    res.json(response);
  } catch (error) {
    console.error("Settle error:", error);
    if (error instanceof Error && error.message.includes("Settlement aborted:")) {
      return res.json({
        success: false,
        errorReason: error.message.replace("Settlement aborted: ", ""),
        network: req.body?.paymentPayload?.network || "unknown",
      });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/supported", async (req, res) => {
  try {
    const response = facilitator.getSupported();
    res.json(response);
  } catch (error) {
    console.error("Supported error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    chain: "plasma",
    chainId: 9745,
    facilitator: walletAccount.address,
  });
});

app.listen(parseInt(PORT), () => {
  console.log(`x402 facilitator running on http://localhost:${PORT}`);
  console.log(`Network: ${PLASMA_NETWORK}`);
  console.log(`USDT0: ${USDT0_ADDRESS}`);
  console.log(`Account: ${walletAccount.address}`);
});
