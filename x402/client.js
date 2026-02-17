import { config } from "dotenv";
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { PLASMA_RPC } from "./config.js";

config();

const mnemonic = process.env.MNEMONIC;
const baseURL = process.env.RESOURCE_SERVER_URL || "http://localhost:4021";
const endpointPath = process.env.ENDPOINT_PATH || "/weather";
const url = `${baseURL}${endpointPath}`;

if (!mnemonic) {
  console.error("MNEMONIC environment variable is required");
  process.exit(1);
}

async function main() {
  const evmSigner = await new WalletManagerEvm(mnemonic, {
    provider: PLASMA_RPC,
  }).getAccount();

  console.log(`Signer address: ${evmSigner.address}`);

  const client = new x402Client();
  registerExactEvmScheme(client, { signer: evmSigner });

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  console.log(`Making request to: ${url}`);

  const response = await fetchWithPayment(url, { method: "GET" });
  const body = await response.json();

  console.log("Response body:", body);

  if (response.ok) {
    const paymentResponse = new x402HTTPClient(client).getPaymentSettleResponse(
      (name) => response.headers.get(name)
    );
    console.log("Payment response:", JSON.stringify(paymentResponse, null, 2));
  } else {
    console.log(`No payment settled (response status: ${response.status})`);
  }
}

main().catch((error) => {
  console.error(error?.response?.data?.error ?? error);
  process.exit(1);
});
