export const ARC_CHAIN_NAME = "arcTestnet";
export const ARC_CHAIN_ID = 5042002;
export const ARC_CAIP2_NETWORK = `eip155:${ARC_CHAIN_ID}`;
export const ARC_BLOCKCHAIN = "ARC-TESTNET";

export const ARC_RPC_URL =
  process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.network";

export const ARC_NATIVE_USDC = {
  symbol: "USDC",
  address: "0x1800000000000000000000000000000000000000",
  decimals: 18
} as const;

export const ARC_ERC20_USDC = {
  symbol: "USDC",
  address: "0x3600000000000000000000000000000000000000",
  decimals: 6
} as const;

export const ARC_GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
export const ARC_GATEWAY_MINTER = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";

export const NANOPAYMENT_PRICE_USDC = "0.002";
export const NANOPAYMENT_PRICE_ATOMIC = "2000";

export const PAYMENT_SURFACES = {
  gateway: "circle-gateway",
  treasury: "app-treasury"
} as const;

export const WALLET_ROLES = {
  user: "user",
  agentBuyer: "agent-buyer",
  seller: "seller",
  treasury: "treasury"
} as const;

export type PaymentSurface = (typeof PAYMENT_SURFACES)[keyof typeof PAYMENT_SURFACES];
export type WalletRole = (typeof WALLET_ROLES)[keyof typeof WALLET_ROLES];
