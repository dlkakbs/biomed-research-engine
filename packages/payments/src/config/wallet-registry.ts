import {
  PAYMENT_SURFACES,
  WALLET_ROLES,
  type PaymentSurface,
  type WalletRole
} from "@biomed/shared";

export interface WalletRegistryEntry {
  key: string;
  role: WalletRole;
  surface: PaymentSurface;
  walletIdEnvs?: string[];
  addressEnvs?: string[];
}

export const WALLET_REGISTRY: WalletRegistryEntry[] = [
  {
    key: "user",
    role: WALLET_ROLES.user,
    surface: PAYMENT_SURFACES.treasury,
    addressEnvs: ["NEXT_PUBLIC_USER_WALLET_ADDRESS"]
  },
  {
    key: "treasury",
    role: WALLET_ROLES.treasury,
    surface: PAYMENT_SURFACES.treasury,
    walletIdEnvs: ["TREASURY_WALLET_ID"],
    addressEnvs: ["TREASURY_WALLET_ADDRESS"]
  },
  {
    key: "pi",
    role: WALLET_ROLES.agentBuyer,
    surface: PAYMENT_SURFACES.gateway,
    walletIdEnvs: ["PI_AGENT_WALLET_ID"],
    addressEnvs: ["PI_AGENT_WALLET_ADDRESS", "PI_AGENT_ADDRESS"]
  },
  {
    key: "literature",
    role: WALLET_ROLES.agentBuyer,
    surface: PAYMENT_SURFACES.gateway,
    walletIdEnvs: ["LITERATURE_AGENT_WALLET_ID"],
    addressEnvs: ["LITERATURE_AGENT_WALLET_ADDRESS", "LITERATURE_AGENT_ADDRESS"]
  },
  {
    key: "drugdb",
    role: WALLET_ROLES.agentBuyer,
    surface: PAYMENT_SURFACES.gateway,
    walletIdEnvs: ["DRUGDB_AGENT_WALLET_ID"],
    addressEnvs: ["DRUGDB_AGENT_WALLET_ADDRESS", "DRUGDB_AGENT_ADDRESS"]
  },
  {
    key: "pathway",
    role: WALLET_ROLES.agentBuyer,
    surface: PAYMENT_SURFACES.gateway,
    walletIdEnvs: ["PATHWAY_AGENT_WALLET_ID"],
    addressEnvs: ["PATHWAY_AGENT_WALLET_ADDRESS", "PATHWAY_AGENT_ADDRESS"]
  },
  {
    key: "repurposing",
    role: WALLET_ROLES.agentBuyer,
    surface: PAYMENT_SURFACES.gateway,
    walletIdEnvs: ["REPURPOSING_AGENT_WALLET_ID"],
    addressEnvs: ["REPURPOSING_AGENT_WALLET_ADDRESS", "REPURPOSING_AGENT_ADDRESS"]
  },
  {
    key: "evidence",
    role: WALLET_ROLES.agentBuyer,
    surface: PAYMENT_SURFACES.gateway,
    walletIdEnvs: ["EVIDENCE_AGENT_WALLET_ID"],
    addressEnvs: ["EVIDENCE_AGENT_WALLET_ADDRESS", "EVIDENCE_AGENT_ADDRESS"]
  },
  {
    key: "red_team",
    role: WALLET_ROLES.agentBuyer,
    surface: PAYMENT_SURFACES.gateway,
    walletIdEnvs: ["RED_TEAM_AGENT_WALLET_ID"],
    addressEnvs: ["RED_TEAM_AGENT_WALLET_ADDRESS", "RED_TEAM_AGENT_ADDRESS"]
  },
  {
    key: "redTeamSeller",
    role: WALLET_ROLES.seller,
    surface: PAYMENT_SURFACES.gateway,
    walletIdEnvs: ["RED_TEAM_SELLER_WALLET_ID", "RED_TEAM_AGENT_WALLET_ID"],
    addressEnvs: ["RED_TEAM_PAYMENT_ADDRESS", "RED_TEAM_SELLER_ADDRESS", "RED_TEAM_AGENT_WALLET_ADDRESS", "RED_TEAM_AGENT_ADDRESS"]
  },
  {
    key: "report",
    role: WALLET_ROLES.agentBuyer,
    surface: PAYMENT_SURFACES.gateway,
    walletIdEnvs: ["REPORT_AGENT_WALLET_ID"],
    addressEnvs: ["REPORT_AGENT_WALLET_ADDRESS", "REPORT_AGENT_ADDRESS"]
  },
  {
    key: "reviewSeller",
    role: WALLET_ROLES.seller,
    surface: PAYMENT_SURFACES.gateway,
    walletIdEnvs: ["REVIEW_SELLER_WALLET_ID"],
    addressEnvs: ["REVIEW_PAYMENT_ADDRESS", "REVIEW_SELLER_ADDRESS"]
  },
];

function resolveEnvValue(names?: string[]): string | null {
  for (const name of names ?? []) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

export function resolveWalletRegistry() {
  return WALLET_REGISTRY.map((entry) => ({
    ...entry,
    walletId: resolveEnvValue(entry.walletIdEnvs),
    address: resolveEnvValue(entry.addressEnvs)
  }));
}

export function resolveWalletRegistryEntry(key: string) {
  return resolveWalletRegistry().find((entry) => entry.key === key) ?? null;
}
