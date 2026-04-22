import {
  ARC_CAIP2_NETWORK,
  ARC_ERC20_USDC,
  NANOPAYMENT_PRICE_USDC,
  PAYMENT_SURFACES,
  WALLET_ROLES,
  type WalletRole
} from "@biomed/shared";

export interface PaymentSystem {
  mode: "circle-gateway";
  network: string;
  gatewayAsset: typeof ARC_ERC20_USDC;
  nanopaymentPriceUsdc: string;
  supportedWalletRoles: WalletRole[];
}

export function createPaymentSystem(): PaymentSystem {
  return {
    mode: "circle-gateway",
    network: ARC_CAIP2_NETWORK,
    gatewayAsset: ARC_ERC20_USDC,
    nanopaymentPriceUsdc: NANOPAYMENT_PRICE_USDC,
    supportedWalletRoles: [
      WALLET_ROLES.user,
      WALLET_ROLES.agentBuyer,
      WALLET_ROLES.seller,
      WALLET_ROLES.treasury
    ]
  };
}

export * from "./config/wallet-registry.js";
export * from "./gateway/buyer.js";
export * from "./gateway/authorization.js";
export * from "./gateway/api-client.js";
export * from "./gateway/challenge.js";
export * from "./gateway/envelope.js";
export * from "./gateway/types.js";
export * from "./contracts/erc8183.js";
export * from "./wallets/index.js";
