import { ExpressAdapter } from "@x402/express";

const log = (tag, ...args) => console.log(`[${new Date().toISOString()}] [${tag}]`, ...args);

export function verifyFirstMiddleware(httpServer, initPromiseHolder, { onEvent } = {}) {
  const emit = onEvent || (() => {});

  return async (req, res, next) => {
    const adapter = new ExpressAdapter(req);
    const context = {
      adapter,
      path: req.path,
      method: req.method,
      paymentHeader:
        adapter.getHeader("payment-signature") ||
        adapter.getHeader("x-payment"),
    };

    if (!httpServer.requiresPayment(context)) {
      log("SERVER", `${req.method} ${req.path} — no payment required`);
      return next();
    }
    log("SERVER", `${req.method} ${req.path} — payment required, hasPayment: ${!!context.paymentHeader}`);

    if (initPromiseHolder.promise) {
      await initPromiseHolder.promise;
      initPromiseHolder.promise = null;
    }

    // Only emit lifecycle events when a payment is actually attached.
    // The first bare request (no payment header) returns 402 silently.
    const hasPayment = !!context.paymentHeader;

    if (hasPayment) {
      log("FACILITATOR", "Step 6: → POST /verify to facilitator");
      emit("verify_started", {
        step: 6,
        title: "Payment Verification Started",
        description: "Facilitator is verifying the payment signature and requirements",
        details: {
          checks: ["Signature validity", "Signer balance", "Nonce uniqueness", "Valid time window"],
        },
        actor: "facilitator",
      });
    }

    const result = await httpServer.processHTTPRequest(context);
    log("SERVER", `processHTTPRequest result: ${result.type}`);

    switch (result.type) {
      case "no-payment-required":
        return next();

      case "payment-error": {
        log("FACILITATOR", `Step 7: Verification FAILED (status: ${result.response.status})`);
        if (hasPayment) {
          emit("verify_failed", {
            step: 7,
            title: "Verification Failed",
            description: "Payment verification failed",
            details: { status: result.response.status },
            actor: "facilitator",
            isError: true,
          });
        }

        const { response } = result;
        res.status(response.status);
        Object.entries(response.headers).forEach(([key, value]) => {
          res.setHeader(key, value);
        });
        if (response.isHtml) {
          res.send(response.body);
        } else {
          res.json(response.body || {});
        }
        return;
      }

      case "payment-verified": {
        const { paymentPayload, paymentRequirements } = result;
        log("FACILITATOR", "Step 7: Verification PASSED");

        emit("verify_completed", {
          step: 7,
          title: "Payment Verified",
          description: "Payment signature and requirements verified successfully",
          details: { isValid: true },
          actor: "facilitator",
        });

        res.on("finish", () => {
          // --- Settle phase ---
          log("FACILITATOR", "Step 9: → POST /settle to facilitator (async, after response sent)");
          emit("settle_started", {
            step: 9,
            title: "On-Chain Settlement Started",
            description: "Broadcasting receiveWithAuthorization transaction to blockchain",
            details: {
              method: "receiveWithAuthorization",
              network: paymentRequirements?.network,
            },
            actor: "facilitator",
            target: "blockchain",
          });

          httpServer
            .processSettlement(paymentPayload, paymentRequirements)
            .then((settleResult) => {
              log("FACILITATOR", `Step 10: Settlement result — success: ${settleResult.success}`, settleResult.transaction ? `tx: ${settleResult.transaction}` : settleResult.errorReason || "");
              if (settleResult.success) {
                emit("settle_completed", {
                  step: 10,
                  title: "Settlement Confirmed",
                  description: "Payment transaction confirmed on blockchain",
                  details: {
                    success: true,
                    transactionHash: settleResult.transaction,
                    network: paymentRequirements?.network,
                  },
                  actor: "blockchain",
                  target: "facilitator",
                });
              } else {
                emit("settle_failed", {
                  step: 10,
                  title: "Settlement Failed",
                  description: `Settlement failed: ${settleResult.errorReason}`,
                  details: { error: settleResult.errorReason },
                  actor: "facilitator",
                  isError: true,
                });
                console.error("Settlement failed:", settleResult.errorReason);
              }
            })
            .catch((err) => {
              log("FACILITATOR", `Step 10: Settlement ERROR — ${err.message}`);
              emit("settle_failed", {
                step: 10,
                title: "Settlement Failed",
                description: `Settlement error: ${err.message}`,
                details: { error: err.message },
                actor: "facilitator",
                isError: true,
              });
              console.error("Settlement error:", err);
            });
        });

        return next();
      }
    }
  };
}
