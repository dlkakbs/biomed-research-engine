import {
  getAgentPayoutWeights,
  getJobBudgetSnapshot,
  getPayoutDistribution,
  listPayoutDistributions,
  logAgentEvent,
  type DatabaseConnection,
  upsertPayoutDistribution
} from "@biomed/db";
import { getErc8183Job, resolveWalletRegistryEntry, transferUsdcAndWait } from "@biomed/payments";

const PI_PAYOUT_RESERVE_BPS = Math.min(Math.max(Number(process.env.PI_PAYOUT_RESERVE_BPS ?? "2000"), 0), 10_000);
const PAYOUT_RECIPIENT_KEYS = [
  "repurposing",
  "evidence",
  "report"
] as const;

type PayoutRecipientKey = (typeof PAYOUT_RECIPIENT_KEYS)[number];

interface PayoutPlanEntry {
  recipientAgent: PayoutRecipientKey;
  recipientWalletId: string;
  recipientAddress: string;
  amountUnits: number;
}

function formatUsdc(amountUnits: number): string {
  return (amountUnits / 1_000_000).toFixed(6);
}

async function getBudgetUnits(db: DatabaseConnection, jobId: string): Promise<{
  budgetUnits: number;
  source: "chain" | "snapshot" | "unavailable";
  chainError?: string;
}> {
  try {
    const onchainJob = await getErc8183Job(jobId);
    const budgetUnits = Number(onchainJob?.budget ?? "0");
    if (budgetUnits > 0) {
      return { budgetUnits, source: "chain" };
    }
  } catch (error) {
    const snapshotBudget = Number(getJobBudgetSnapshot({ db, jobId }));
    if (snapshotBudget > 0) {
      return {
        budgetUnits: snapshotBudget,
        source: "snapshot",
        chainError: error instanceof Error ? error.message : String(error)
      };
    }
    return {
      budgetUnits: 0,
      source: "unavailable",
      chainError: error instanceof Error ? error.message : String(error)
    };
  }

  const snapshotBudget = Number(getJobBudgetSnapshot({ db, jobId }));
  if (snapshotBudget > 0) {
    return { budgetUnits: snapshotBudget, source: "snapshot" };
  }
  return { budgetUnits: 0, source: "unavailable" };
}

async function computePayoutPlan(input: {
  db: DatabaseConnection;
  jobId: string;
}): Promise<{
  entries: PayoutPlanEntry[];
  missingRecipients: string[];
  jobBudgetUnits: number;
  reserveUnits: number;
  distributableUnits: number;
  reserveBps: number;
  reason?: string;
}> {
  const recipientConfigs = PAYOUT_RECIPIENT_KEYS.map((key) => ({
    key,
    walletId: resolveWalletRegistryEntry(key)?.walletId?.trim() ?? "",
    address: resolveWalletRegistryEntry(key)?.address?.trim() ?? ""
  }));
  const configuredRecipients = recipientConfigs.filter((recipient) => recipient.walletId && recipient.address);
  const missingRecipients = recipientConfigs.filter((recipient) => !recipient.walletId || !recipient.address).map((recipient) => recipient.key);

  if (configuredRecipients.length === 0) {
    return {
      entries: [],
      missingRecipients,
      jobBudgetUnits: 0,
      reserveUnits: 0,
      distributableUnits: 0,
      reserveBps: PI_PAYOUT_RESERVE_BPS,
      reason: "no payout recipients configured"
    };
  }

  const weights = getAgentPayoutWeights({
    db: input.db,
    jobId: input.jobId,
    agentNames: configuredRecipients.map((recipient) => recipient.key)
  });
  if (weights.length === 0) {
    return {
      entries: [],
      missingRecipients,
      jobBudgetUnits: 0,
      reserveUnits: 0,
      distributableUnits: 0,
      reserveBps: PI_PAYOUT_RESERVE_BPS,
      reason: "no successful agent ledger entries for configured recipients"
    };
  }

  const budgetInfo = await getBudgetUnits(input.db, input.jobId);
  if (budgetInfo.budgetUnits <= 0) {
    return {
      entries: [],
      missingRecipients,
      jobBudgetUnits: budgetInfo.budgetUnits,
      reserveUnits: 0,
      distributableUnits: 0,
      reserveBps: PI_PAYOUT_RESERVE_BPS,
      reason:
        budgetInfo.source === "unavailable"
          ? `job budget is zero or unavailable${budgetInfo.chainError ? ` (${budgetInfo.chainError})` : ""}`
          : "job budget is zero"
    };
  }

  const totalWeight = weights.reduce((sum, item) => sum + item.payoutWeight, 0);
  if (totalWeight <= 0) {
    return {
      entries: [],
      missingRecipients,
      jobBudgetUnits: budgetInfo.budgetUnits,
      reserveUnits: 0,
      distributableUnits: 0,
      reserveBps: PI_PAYOUT_RESERVE_BPS,
      reason: "total payout weight is zero"
    };
  }

  const reserveUnits = Math.floor((budgetInfo.budgetUnits * PI_PAYOUT_RESERVE_BPS) / 10_000);
  const distributableUnits = budgetInfo.budgetUnits - reserveUnits;
  if (distributableUnits <= 0) {
    return {
      entries: [],
      missingRecipients,
      jobBudgetUnits: budgetInfo.budgetUnits,
      reserveUnits,
      distributableUnits,
      reserveBps: PI_PAYOUT_RESERVE_BPS,
      reason: "reserve consumed full budget"
    };
  }

  let remaining = distributableUnits;
  const sortedWeights = [...weights].sort((a, b) => b.payoutWeight - a.payoutWeight);
  const entries: PayoutPlanEntry[] = [];
  for (const [index, weight] of sortedWeights.entries()) {
    const recipient = recipientConfigs.find((entry) => entry.key === weight.agentName);
    const amountUnits =
      index === sortedWeights.length - 1
        ? remaining
        : Math.floor((distributableUnits * weight.payoutWeight) / totalWeight);
    remaining -= amountUnits;
    if (amountUnits <= 0 || !recipient?.walletId || !recipient.address) continue;
    entries.push({
      recipientAgent: weight.agentName as PayoutRecipientKey,
      recipientWalletId: recipient.walletId,
      recipientAddress: recipient.address,
      amountUnits
    });
  }

  return {
    entries,
    missingRecipients,
    jobBudgetUnits: budgetInfo.budgetUnits,
    reserveUnits,
    distributableUnits,
    reserveBps: PI_PAYOUT_RESERVE_BPS
  };
}

export async function distributeInternalPayouts(input: {
  db: DatabaseConnection;
  jobId: string;
}): Promise<{
  status: "success" | "partial_failure" | "skipped";
  reason?: string;
  records: ReturnType<typeof listPayoutDistributions>;
  failures?: Array<{ recipientAgent: string; error: string }>;
  missingRecipients?: string[];
  jobBudgetUnits?: number;
  reserveUnits?: number;
  distributableUnits?: number;
  reserveBps?: number;
}> {
  const piWalletId = process.env.PI_AGENT_WALLET_ID?.trim();
  if (!piWalletId) {
    return {
      status: "skipped",
      reason: "PI_AGENT_WALLET_ID not set",
      records: []
    };
  }

  const payoutPlan = await computePayoutPlan(input);
  if (payoutPlan.missingRecipients.length > 0) {
    logAgentEvent({
      db: input.db,
      jobId: input.jobId,
      agentName: "pi",
      eventType: "info",
      message: `Internal payout config missing for: ${payoutPlan.missingRecipients.join(", ")}`
    });
  }

  if (payoutPlan.entries.length === 0) {
    return {
      status: "skipped",
      reason: payoutPlan.reason ?? "no payout plan",
      records: listPayoutDistributions({ db: input.db, jobId: input.jobId }),
      missingRecipients: payoutPlan.missingRecipients,
      jobBudgetUnits: payoutPlan.jobBudgetUnits,
      reserveUnits: payoutPlan.reserveUnits,
      distributableUnits: payoutPlan.distributableUnits,
      reserveBps: payoutPlan.reserveBps
    };
  }

  const failures: Array<{ recipientAgent: string; error: string }> = [];
  for (const entry of payoutPlan.entries) {
    const existing = getPayoutDistribution({
      db: input.db,
      jobId: input.jobId,
      recipientAgent: entry.recipientAgent
    });
    if (existing?.status === "success") {
      continue;
    }

    upsertPayoutDistribution({
      db: input.db,
      jobId: input.jobId,
      recipientAgent: entry.recipientAgent,
      recipientWalletId: entry.recipientWalletId,
      recipientAddress: entry.recipientAddress,
      amountUnits: entry.amountUnits,
      circleTransactionId: existing?.circleTransactionId ?? null,
      txHash: existing?.txHash ?? null,
      status: "pending",
      error: null
    });

    try {
      const transfer = await transferUsdcAndWait({
        fromWalletId: piWalletId,
        toAddress: entry.recipientAddress,
        amountUnits: entry.amountUnits
      });
      upsertPayoutDistribution({
        db: input.db,
        jobId: input.jobId,
        recipientAgent: entry.recipientAgent,
        recipientWalletId: entry.recipientWalletId,
        recipientAddress: entry.recipientAddress,
        amountUnits: entry.amountUnits,
        circleTransactionId: transfer.id,
        txHash: transfer.txHash ?? null,
        status: "success",
        error: null
      });
      logAgentEvent({
        db: input.db,
        jobId: input.jobId,
        agentName: "pi",
        eventType: "payout",
        targetAgent: entry.recipientAgent,
        message: `Internal payout sent to ${entry.recipientAgent}: $${formatUsdc(entry.amountUnits)} USDC tx=${transfer.txHash ?? transfer.id}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ recipientAgent: entry.recipientAgent, error: message });
      upsertPayoutDistribution({
        db: input.db,
        jobId: input.jobId,
        recipientAgent: entry.recipientAgent,
        recipientWalletId: entry.recipientWalletId,
        recipientAddress: entry.recipientAddress,
        amountUnits: entry.amountUnits,
        status: "failed",
        error: message
      });
      logAgentEvent({
        db: input.db,
        jobId: input.jobId,
        agentName: "pi",
        eventType: "error",
        targetAgent: entry.recipientAgent,
        message: `Internal payout failed for ${entry.recipientAgent}: ${message}`
      });
    }
  }

  return {
    status: failures.length > 0 ? "partial_failure" : "success",
    failures: failures.length > 0 ? failures : undefined,
    records: listPayoutDistributions({ db: input.db, jobId: input.jobId }),
    missingRecipients: payoutPlan.missingRecipients,
    jobBudgetUnits: payoutPlan.jobBudgetUnits,
    reserveUnits: payoutPlan.reserveUnits,
    distributableUnits: payoutPlan.distributableUnits,
    reserveBps: payoutPlan.reserveBps
  };
}
