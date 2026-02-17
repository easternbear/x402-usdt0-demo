import { ExpressAdapter } from "@x402/express";

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
      return next();
    }

    if (initPromiseHolder.promise) {
      await initPromiseHolder.promise;
      initPromiseHolder.promise = null;
    }

    // Only emit lifecycle events when a payment is actually attached.
    // The first bare request (no payment header) returns 402 silently.
    const hasPayment = !!context.paymentHeader;

    if (hasPayment) {
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

    switch (result.type) {
      case "no-payment-required":
        return next();

      case "payment-error": {
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

        emit("verify_completed", {
          step: 7,
          title: "Payment Verified",
          description: "Payment signature and requirements verified successfully",
          details: { isValid: true },
          actor: "facilitator",
        });

        res.on("finish", () => {
          // --- Settle phase ---
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
