import type { GatewayChallenge } from "./types.js";
import { NANOPAYMENT_PRICE_ATOMIC } from "@biomed/shared";

const PAYMENT_HEADER_MAP = {
  payTo: "x-payment-address",
  amount: "x-payment-amount",
  currency: "x-payment-currency",
  chain: "x-payment-chain",
  network: "x-payment-network",
  tokenAddress: "x-payment-token-address"
} as const;

export async function readGatewayChallenge(response: Response): Promise<GatewayChallenge> {
  const paymentRequired = response.headers.get("payment-required");
  if (paymentRequired) {
    const decoded = JSON.parse(Buffer.from(paymentRequired, "base64").toString("utf8")) as {
      x402Version?: number;
      accepts?: Array<{
        scheme?: string;
        network?: string;
        asset?: string;
        amount?: string;
        payTo?: string;
        maxTimeoutSeconds?: number;
        extra?: Record<string, unknown>;
      }>;
    };

    const gatewayOption =
      decoded.accepts?.find((option) => option.extra?.name === "GatewayWalletBatched") ??
      decoded.accepts?.[0];

    if (gatewayOption?.payTo) {
      return {
        payTo: gatewayOption.payTo,
        amount: gatewayOption.amount ?? "",
        currency: "USDC",
        network: gatewayOption.network,
        tokenAddress: gatewayOption.asset,
        scheme: gatewayOption.scheme,
        maxTimeoutSeconds: gatewayOption.maxTimeoutSeconds,
        extra: gatewayOption.extra,
        x402Version: decoded.x402Version,
        resource: response.url
      };
    }
  }

  const fromHeaders: GatewayChallenge = {
    payTo: response.headers.get(PAYMENT_HEADER_MAP.payTo) ?? "",
    amount: response.headers.get(PAYMENT_HEADER_MAP.amount) ?? "",
    currency: response.headers.get(PAYMENT_HEADER_MAP.currency) ?? "",
    chain: response.headers.get(PAYMENT_HEADER_MAP.chain) ?? undefined,
    network: response.headers.get(PAYMENT_HEADER_MAP.network) ?? undefined,
    tokenAddress: response.headers.get(PAYMENT_HEADER_MAP.tokenAddress) ?? undefined,
    resource: response.url
  };

  if (fromHeaders.payTo) {
    return fromHeaders;
  }

  const body = (await response.json()) as Record<string, string | undefined>;

  return {
    payTo: body.pay_to ?? body.payment_address ?? "",
    amount: body.amount ?? body.payment_amount_usdc ?? NANOPAYMENT_PRICE_ATOMIC,
    currency: body.currency ?? "USDC",
    chain: body.chain,
    network: body.network,
    tokenAddress: body.token_address,
    scheme: body.scheme,
    maxTimeoutSeconds: body.maxTimeoutSeconds ? Number(body.maxTimeoutSeconds) : undefined,
    extra: undefined,
    x402Version: body.x402Version ? Number(body.x402Version) : undefined,
    resource: response.url
  };
}
