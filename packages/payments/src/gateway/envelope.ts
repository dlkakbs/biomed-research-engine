import { ARC_CAIP2_NETWORK, ARC_ERC20_USDC } from "@biomed/shared";
import type { X402PaymentPayload, X402PaymentRequirements } from "./api-client.js";
import type { GatewayChallenge } from "./types.js";

export function buildPaymentRequirementsFromChallenge(
  challenge: GatewayChallenge
): X402PaymentRequirements {
  return {
    scheme: challenge.scheme ?? "exact",
    network: challenge.network ?? ARC_CAIP2_NETWORK,
    asset: challenge.tokenAddress ?? ARC_ERC20_USDC.address,
    amount: challenge.amount,
    payTo: challenge.payTo,
    maxTimeoutSeconds: challenge.maxTimeoutSeconds,
    extra: challenge.extra ?? {}
  };
}

export function buildX402PaymentPayload(input: {
  challenge: GatewayChallenge;
  resourceUrl: string;
  resourceDescription?: string;
  mimeType?: string;
  payload: Record<string, unknown>;
}): X402PaymentPayload {
  return {
    x402Version: input.challenge.x402Version ?? 2,
    accepted: buildPaymentRequirementsFromChallenge(input.challenge),
    payload: input.payload,
    resource: {
      url: input.challenge.resource ?? input.resourceUrl,
      description: input.resourceDescription ?? "BioMed research step",
      mimeType: input.mimeType ?? "application/json"
    },
    extensions: {}
  };
}
