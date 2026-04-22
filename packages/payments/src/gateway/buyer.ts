import {
  ARC_CAIP2_NETWORK,
  ARC_CHAIN_NAME,
  ARC_ERC20_USDC,
  NANOPAYMENT_PRICE_ATOMIC
} from "@biomed/shared";
import { resolveWalletRegistry } from "../config/wallet-registry.js";
import {
  buildGatewayTypedData,
  encodePaymentSignatureHeader,
  signBuyerAuthorization,
  type GatewayTypedData
} from "./authorization.js";
import { buildX402PaymentPayload, buildPaymentRequirementsFromChallenge } from "./envelope.js";
import { readGatewayChallenge } from "./challenge.js";
import type { GatewayChallenge, PaidRequestInput, PaidServiceResponse } from "./types.js";
import type { CircleWalletClient } from "../wallets/circle-client.js";

export interface BuyerPaymentPlan {
  buyerKey: PaidRequestInput<unknown>["buyerKey"];
  buyerWalletId: string | null;
  buyerAddress: string | null;
  network: string;
  expectedAsset: typeof ARC_ERC20_USDC;
  defaultAmountUsdc: string;
}

export function createBuyerPaymentPlan(
  buyerKey: PaidRequestInput<unknown>["buyerKey"]
): BuyerPaymentPlan {
  const registry = resolveWalletRegistry();
  const entry = registry.find((item) => item.key === buyerKey);

  return {
    buyerKey,
    buyerWalletId: entry?.walletId ?? null,
    buyerAddress: entry?.address ?? null,
    network: ARC_CHAIN_NAME,
    expectedAsset: ARC_ERC20_USDC,
    defaultAmountUsdc: NANOPAYMENT_PRICE_ATOMIC
  };
}

export async function requestPaidService<TPayload, TData>(
  input: PaidRequestInput<TPayload> & { circle?: CircleWalletClient }
): Promise<PaidServiceResponse<TData>> {
  const initial = await fetch(`${input.baseUrl.replace(/\/$/, "")}${input.endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input.payload)
  });

  if (initial.status !== 402) {
    return {
      status: "ok",
      data: (await initial.json()) as TData
    };
  }

  const challenge = await readGatewayChallenge(initial);
  const plan = createBuyerPaymentPlan(input.buyerKey);

  if (!input.circle) {
    throw new Error(
      [
        `Paid service challenge received for ${input.buyerKey}.`,
        `Expected Circle Gateway flow on ${plan.network}.`,
        `Challenge payTo=${challenge.payTo || "<missing>"}`,
        `Challenge amount=${challenge.amount || plan.defaultAmountUsdc}`,
        "Circle wallet client was not provided for buyer authorization."
      ].join(" ")
    );
  }

  const buyerAddress =
    plan.buyerAddress ??
    (plan.buyerWalletId ? (await input.circle.getWallet(plan.buyerWalletId)).address : null);

  const typedData = buildGatewayTypedData({
    challenge,
    buyerAddress: buyerAddress ?? "0x0000000000000000000000000000000000000000"
  });

  const authorization = await signBuyerAuthorization({
    circle: input.circle,
    request: {
      buyerKey: input.buyerKey,
      challenge,
      typedData
    }
  });

  const paymentRequirements = buildPaymentRequirementsFromChallenge(challenge);
  const paymentPayload = buildX402PaymentPayload({
    challenge,
    resourceUrl: `${input.baseUrl.replace(/\/$/, "")}${input.endpoint}`,
    resourceDescription: `BioMed research step for ${input.buyerKey}`,
    mimeType: "application/json",
    payload: {
      authorization: authorization.authorization,
      signature: authorization.signature
    }
  });

  const paymentHeader = encodePaymentSignatureHeader({
    accepted: challenge,
    typedData,
    signature: authorization.signature
  });

  const replay = await fetch(`${input.baseUrl.replace(/\/$/, "")}${input.endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "payment-signature": paymentHeader
    },
    body: JSON.stringify(input.payload)
  });

  if (!replay.ok) {
    throw new Error(
      [
        `Gateway replay failed for ${authorization.buyerKey}.`,
        `status=${replay.status}`,
        `payTo=${authorization.payTo}`,
        `amount=${authorization.amount}`,
        `x402Version=${paymentPayload.x402Version}`,
        `scheme=${paymentRequirements.scheme}`,
        `network=${paymentRequirements.network ?? ARC_CAIP2_NETWORK}`,
        `paymentHeaderBytes=${paymentHeader.length}`,
        `body=${await replay.text()}`
      ].join(" ")
    );
  }

  const body = (await replay.json()) as Record<string, unknown>;
  const paymentResponseHeader = replay.headers.get("payment-response");
  let paymentResponse: PaidServiceResponse<TData>["paymentResponse"];
  if (paymentResponseHeader) {
    try {
      paymentResponse = JSON.parse(paymentResponseHeader) as PaidServiceResponse<TData>["paymentResponse"];
    } catch {
      paymentResponse = undefined;
    }
  }

  return {
    status: "ok",
    data: (body.data ?? body) as TData,
    endpoint: typeof body.endpoint === "string" ? body.endpoint : undefined,
    servicePath: typeof body.servicePath === "string" ? body.servicePath : undefined,
    seller: typeof body.seller === "string" ? body.seller : undefined,
    verification:
      typeof body.verification === "object" && body.verification !== null
        ? (body.verification as PaidServiceResponse<TData>["verification"])
        : undefined,
    paymentResponse,
    authorization: {
      buyerWalletId: authorization.buyerWalletId,
      payer: authorization.authorization.from,
      payTo: authorization.authorization.to,
      amount: authorization.authorization.value,
      validAfter: authorization.authorization.validAfter,
      validBefore: authorization.authorization.validBefore,
      nonce: authorization.authorization.nonce,
      x402Version: paymentPayload.x402Version,
      resourceUrl:
        typeof paymentPayload.resource === "string" ? paymentPayload.resource : paymentPayload.resource.url
    }
  };
}

export function normalizeChallengeAmount(challenge: GatewayChallenge): string {
  return challenge.amount || NANOPAYMENT_PRICE_ATOMIC;
}

export function buildStubGatewayTypedData(input: {
  challenge: GatewayChallenge;
  buyerAddress: string;
}): GatewayTypedData {
  return buildGatewayTypedData(input);
}
