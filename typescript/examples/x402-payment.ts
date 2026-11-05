// Paid calls with x402 (USDC on Base). The SDK has no crypto dependency:
// you plug in any signer that returns a base64 x402 payment payload.
//
// This example builds the signer with the x402 reference libraries
// (`npm i viem @x402/fetch @x402/evm` — check their docs for the current API).
import { Lilambd, PaymentRequiredError } from "lilambd";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const account = privateKeyToAccount(process.env.WALLET_PRIVATE_KEY as `0x${string}`);
const x402 = new x402Client();
registerExactEvmScheme(x402, { signer: account });
const http = new x402HTTPClient(x402);

const client = new Lilambd({
  maxPriceUsd: 0.05, // never pay more than 5 cents per call
  paymentSigner: async ({ paymentRequired, priceUsd, url }) => {
    console.log(`paying ${priceUsd} USD for ${url}`);
    const payload = await x402.createPaymentPayload(paymentRequired as never);
    const headers = http.encodePaymentSignatureHeader(payload);
    return headers["PAYMENT-SIGNATURE"] ?? Object.values(headers)[0];
  },
});

try {
  const rows = await client.hazard.placeRisk({ lat: 35.68, lon: 139.76 });
  console.log(rows);
} catch (err) {
  if (err instanceof PaymentRequiredError) {
    console.error("payment needed:", err.priceUsd, "USD", err.requirement);
  } else {
    throw err;
  }
}
