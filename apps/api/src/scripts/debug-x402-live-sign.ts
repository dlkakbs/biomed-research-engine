import "dotenv/config";

import {
  CircleGatewayApiClient,
  CircleWalletClient,
  buildGatewayTypedData,
  buildPaymentRequirementsFromChallenge,
  buildX402PaymentPayload,
  signBuyerAuthorization
} from "@biomed/payments";
import { ARC_CAIP2_NETWORK, ARC_ERC20_USDC, ARC_GATEWAY_WALLET } from "@biomed/shared";

type BuyerKey = "pi" | "literature" | "drugdb";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function resolveWalletId(key: BuyerKey): string {
  const envName =
    key === "pi"
      ? "PI_AGENT_WALLET_ID"
      : key === "literature"
        ? "LITERATURE_AGENT_WALLET_ID"
        : "DRUGDB_AGENT_WALLET_ID";
  return requireEnv(envName);
}

function pickDistinctCounterparty(buyer: BuyerKey): BuyerKey {
  if (buyer === "pi") return "literature";
  if (buyer === "literature") return "drugdb";
  return "pi";
}

async function main() {
  const buyerKey = (process.env.DEBUG_BUYER_KEY?.trim() as BuyerKey | undefined) ?? "pi";
  const sellerKey = pickDistinctCounterparty(buyerKey);

  const circle = CircleWalletClient.fromEnv();
  const gateway = new CircleGatewayApiClient();

  const buyerWallet = await circle.getWallet(resolveWalletId(buyerKey));
  const sellerWallet = await circle.getWallet(resolveWalletId(sellerKey));

  const challenge = {
    payTo: sellerWallet.address,
    amount: "2000",
    currency: "USDC",
    network: ARC_CAIP2_NETWORK,
    tokenAddress: ARC_ERC20_USDC.address,
    scheme: "exact",
    maxTimeoutSeconds: 345600,
    x402Version: 2,
    resource: "https://biomed.local/debug/live-x402",
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: ARC_GATEWAY_WALLET
    }
  } as const;

  const typedData = buildGatewayTypedData({
    challenge,
    buyerAddress: buyerWallet.address
  });

  const authorization = await signBuyerAuthorization({
    circle,
    request: {
      buyerKey,
      challenge,
      typedData,
      memo: `Debug live x402 verify for ${buyerKey}`
    }
  });

  const paymentRequirements = buildPaymentRequirementsFromChallenge(challenge);
  const paymentPayload = buildX402PaymentPayload({
    challenge,
    resourceUrl: challenge.resource,
    resourceDescription: "Live Circle Gateway verify debug resource",
    mimeType: "application/json",
    payload: {
      authorization: authorization.authorization,
      signature: authorization.signature
    }
  });

  const verify = await gateway.verifyX402Payment({
    paymentPayload,
    paymentRequirements
  });

  console.log(
    JSON.stringify(
      {
        buyerKey,
        buyerWalletId: buyerWallet.id,
        buyerAddress: buyerWallet.address,
        sellerWalletId: sellerWallet.id,
        sellerAddress: sellerWallet.address,
        verify
      },
      null,
      2
    )
  );

  if (!verify.isValid) {
    return;
  }

  const settle = await gateway.settleX402Payment({
    paymentPayload,
    paymentRequirements
  });

  console.log(JSON.stringify({ settle }, null, 2));
}

void main();
