import {
  ARC_CAIP2_NETWORK,
  ARC_CHAIN_NAME,
  ARC_ERC20_USDC,
  ARC_GATEWAY_WALLET,
  NANOPAYMENT_PRICE_ATOMIC
} from "@biomed/shared";

export interface SellerChallengeInput {
  chainId: number;
  payTo: string;
  amount?: string;
  replayed?: boolean;
}

export interface SellerChallengeResponse {
  statusCode: 402;
  headers: Record<string, string>;
  body: {
    error: "payment_required" | "payment_already_used";
    replayed: boolean;
    amount: string;
    currency: "USDC";
    network: string;
    pay_to: string;
    token_address: string;
  };
}

export function buildSellerChallenge(input: SellerChallengeInput): SellerChallengeResponse {
  const amount = input.amount ?? NANOPAYMENT_PRICE_ATOMIC;
  const replayed = input.replayed ?? false;
  const accepts = [
    {
      scheme: "exact",
      network: ARC_CAIP2_NETWORK,
      asset: ARC_ERC20_USDC.address,
      amount,
      payTo: input.payTo,
      maxTimeoutSeconds: 345600,
      extra: {
        name: "GatewayWalletBatched",
        version: "1",
        chain: ARC_CHAIN_NAME,
        verifyingContract: ARC_GATEWAY_WALLET
      }
    }
  ];
  const paymentRequired = Buffer.from(
    JSON.stringify({
      x402Version: 2,
      error: replayed ? "payment_already_used" : "payment_required",
      accepts
    })
  ).toString("base64");

  return {
    statusCode: 402,
    headers: {
      "X-Payment-Amount": amount,
      "X-Payment-Currency": "USDC",
      "X-Payment-Chain": String(input.chainId),
      "X-Payment-Network": ARC_CAIP2_NETWORK,
      "X-Payment-Address": input.payTo,
      "X-Payment-Token-Address": ARC_ERC20_USDC.address,
      "PAYMENT-REQUIRED": paymentRequired
    },
    body: {
      error: replayed ? "payment_already_used" : "payment_required",
      replayed,
      amount,
      currency: "USDC",
      network: ARC_CAIP2_NETWORK,
      pay_to: input.payTo,
      token_address: ARC_ERC20_USDC.address
    }
  };
}
