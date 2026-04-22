import { randomBytes } from "node:crypto";
import {
  ARC_CAIP2_NETWORK,
  ARC_CHAIN_ID,
  ARC_CHAIN_NAME,
  ARC_ERC20_USDC,
  ARC_GATEWAY_WALLET
} from "@biomed/shared";
import type { CircleWalletClient } from "../wallets/circle-client.js";
import { createBuyerPaymentPlan, normalizeChallengeAmount } from "./buyer.js";
import type { GatewayChallenge, PaidRequestInput } from "./types.js";

const MIN_VALIDITY_SECONDS = 60 * 60 * 24 * 3;
const DEFAULT_VALIDITY_SECONDS = 60 * 60 * 24 * 5;

export interface TransferWithAuthorizationMessage {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: `0x${string}`;
}

export interface GatewayTypedData {
  types: {
    EIP712Domain: Array<{ name: string; type: string }>;
    TransferWithAuthorization: Array<{ name: string; type: string }>;
  };
  primaryType: "TransferWithAuthorization";
  domain: {
    name: "GatewayWalletBatched";
    version: "1";
    chainId: number;
    verifyingContract: string;
  };
  message: TransferWithAuthorizationMessage;
}

export interface BuyerAuthorizationRequest {
  buyerKey: PaidRequestInput<unknown>["buyerKey"];
  challenge: GatewayChallenge;
  typedData: GatewayTypedData;
  memo?: string;
}

export interface BuyerAuthorizationResult {
  buyerKey: BuyerAuthorizationRequest["buyerKey"];
  buyerWalletId: string;
  signature: string;
  amount: string;
  payTo: string;
  typedData: GatewayTypedData;
  authorization: TransferWithAuthorizationMessage;
}

function createNonce(): `0x${string}` {
  return `0x${randomBytes(32).toString("hex")}`;
}

export function createTransferWithAuthorization(input: {
  buyerAddress: string;
  challenge: GatewayChallenge;
}): TransferWithAuthorizationMessage {
  const now = Math.floor(Date.now() / 1000);
  const requestedWindow = input.challenge.maxTimeoutSeconds ?? DEFAULT_VALIDITY_SECONDS;
  const safeWindow = Math.max(requestedWindow, MIN_VALIDITY_SECONDS);

  return {
    from: input.buyerAddress,
    to: input.challenge.payTo,
    value: normalizeChallengeAmount(input.challenge),
    validAfter: "0",
    validBefore: String(now + safeWindow),
    nonce: createNonce()
  };
}

export function buildGatewayTypedData(input: {
  challenge: GatewayChallenge;
  buyerAddress: string;
}): GatewayTypedData {
  const authorization = createTransferWithAuthorization(input);
  const verifyingContract =
    typeof input.challenge.extra?.verifyingContract === "string" &&
    input.challenge.extra.verifyingContract
      ? input.challenge.extra.verifyingContract
      : ARC_GATEWAY_WALLET;

  return {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ],
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]
    },
    primaryType: "TransferWithAuthorization",
    domain: {
      name: "GatewayWalletBatched",
      version: "1",
      chainId: ARC_CHAIN_ID,
      verifyingContract
    },
    message: authorization
  };
}

export function encodePaymentSignatureHeader(input: {
  accepted: GatewayChallenge;
  typedData: GatewayTypedData;
  signature: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      x402Version: input.accepted.x402Version ?? 2,
      accepted: {
        scheme: input.accepted.scheme ?? "exact",
        network: input.accepted.network ?? ARC_CAIP2_NETWORK,
        asset: input.accepted.tokenAddress ?? ARC_ERC20_USDC.address,
        amount: input.accepted.amount,
        payTo: input.accepted.payTo,
        maxTimeoutSeconds: input.accepted.maxTimeoutSeconds,
        extra: {
          name: input.accepted.extra?.name ?? "GatewayWalletBatched",
          version: input.accepted.extra?.version ?? "1",
          verifyingContract:
            input.accepted.extra?.verifyingContract ?? input.typedData.domain.verifyingContract
        }
      },
      payload: {
        authorization: input.typedData.message,
        signature: input.signature
      },
      resource: input.accepted.resource ?? "",
      extensions: {}
    })
  ).toString("base64");
}

export function decodePaymentSignatureHeader(value: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as Record<string, unknown>;
}

export async function signBuyerAuthorization(input: {
  circle: CircleWalletClient;
  request: BuyerAuthorizationRequest;
}): Promise<BuyerAuthorizationResult> {
  const plan = createBuyerPaymentPlan(input.request.buyerKey);
  if (!plan.buyerWalletId) {
    throw new Error(`No buyer wallet id configured for ${input.request.buyerKey}`);
  }

  if (plan.network !== ARC_CHAIN_NAME) {
    throw new Error(`Unsupported buyer network ${plan.network}`);
  }

  const response = await input.circle.signTypedData({
    walletId: plan.buyerWalletId,
    typedData: input.request.typedData as unknown as Record<string, unknown>,
    memo:
      input.request.memo ??
      `Authorize Gateway nanopayment of ${normalizeChallengeAmount(input.request.challenge)} USDC`
  });

  const data = (response.data as Record<string, unknown> | undefined) ?? response;
  const signature = data.signature;
  if (typeof signature !== "string" || !signature) {
    throw new Error("Circle signTypedData response did not include a signature");
  }

  return {
    buyerKey: input.request.buyerKey,
    buyerWalletId: plan.buyerWalletId,
    signature,
    amount: normalizeChallengeAmount(input.request.challenge),
    payTo: input.request.challenge.payTo,
    typedData: input.request.typedData,
    authorization: input.request.typedData.message
  };
}
