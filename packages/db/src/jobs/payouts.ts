import type { DatabaseConnection } from "../client/database.js";

export interface AgentLedgerEntryInput {
  jobId: string;
  agentName: string;
  status: string;
  baseCost: number;
  contributionWeight: number;
  riskWeight: number;
  payoutWeight: number;
  notes?: string;
}

export interface AgentPayoutWeight {
  agentName: string;
  payoutWeight: number;
}

export interface PayoutDistributionRecord {
  recipientAgent: string;
  recipientWalletId: string | null;
  recipientAddress: string;
  amountUnits: number;
  circleTransactionId: string | null;
  txHash: string | null;
  status: string;
  error: string | null;
  updatedAt: string;
}

function mapPayoutRow(row: {
  recipient_agent: string;
  recipient_wallet_id: string | null;
  recipient_address: string;
  amount_units: string | number;
  circle_transaction_id: string | null;
  tx_hash: string | null;
  status: string;
  error: string | null;
  updated_at: string;
}): PayoutDistributionRecord {
  return {
    recipientAgent: row.recipient_agent,
    recipientWalletId: row.recipient_wallet_id,
    recipientAddress: row.recipient_address,
    amountUnits: Number(row.amount_units),
    circleTransactionId: row.circle_transaction_id,
    txHash: row.tx_hash,
    status: row.status,
    error: row.error,
    updatedAt: row.updated_at
  };
}

export function insertAgentLedgerEntry(input: {
  db: DatabaseConnection;
  entry: AgentLedgerEntryInput;
}): void {
  input.db.sqlite
    .prepare(
      `
        INSERT INTO agent_ledger_entries (
          job_id, agent_name, status, base_cost, contribution_weight, risk_weight, payout_weight, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      input.entry.jobId,
      input.entry.agentName,
      input.entry.status,
      input.entry.baseCost,
      input.entry.contributionWeight,
      input.entry.riskWeight,
      input.entry.payoutWeight,
      input.entry.notes ?? null
    );
}

export function getAgentPayoutWeights(input: {
  db: DatabaseConnection;
  jobId: string;
  agentNames: string[];
}): AgentPayoutWeight[] {
  const statement = input.db.sqlite.prepare(
    `
      SELECT agent_name, payout_weight
      FROM agent_ledger_entries
      WHERE job_id = ? AND agent_name = ? AND status = 'success'
      ORDER BY id DESC
      LIMIT 1
    `
  );

  const rows: AgentPayoutWeight[] = [];
  for (const agentName of input.agentNames) {
    const row = statement.get(input.jobId, agentName) as
      | { agent_name: string; payout_weight: number }
      | undefined;
    if (!row) continue;
    rows.push({
      agentName: row.agent_name,
      payoutWeight: Number(row.payout_weight)
    });
  }

  return rows;
}

export function getPayoutDistribution(input: {
  db: DatabaseConnection;
  jobId: string;
  recipientAgent: string;
}): PayoutDistributionRecord | null {
  const row = input.db.sqlite
    .prepare(
      `
        SELECT recipient_agent, recipient_wallet_id, recipient_address, amount_units,
               circle_transaction_id, tx_hash, status, error, updated_at
        FROM payout_distributions
        WHERE job_id = ? AND recipient_agent = ?
      `
    )
    .get(input.jobId, input.recipientAgent) as
    | {
        recipient_agent: string;
        recipient_wallet_id: string | null;
        recipient_address: string;
        amount_units: string | number;
        circle_transaction_id: string | null;
        tx_hash: string | null;
        status: string;
        error: string | null;
        updated_at: string;
      }
    | undefined;

  return row ? mapPayoutRow(row) : null;
}

export function upsertPayoutDistribution(input: {
  db: DatabaseConnection;
  jobId: string;
  recipientAgent: string;
  recipientWalletId?: string | null;
  recipientAddress: string;
  amountUnits: number;
  circleTransactionId?: string | null;
  txHash?: string | null;
  status?: string;
  error?: string | null;
}): void {
  input.db.sqlite
    .prepare(
      `
        INSERT INTO payout_distributions (
          job_id, recipient_agent, recipient_wallet_id, recipient_address, amount_units,
          circle_transaction_id, tx_hash, status, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(job_id, recipient_agent) DO UPDATE SET
          recipient_wallet_id = excluded.recipient_wallet_id,
          recipient_address = excluded.recipient_address,
          amount_units = excluded.amount_units,
          circle_transaction_id = excluded.circle_transaction_id,
          tx_hash = excluded.tx_hash,
          status = excluded.status,
          error = excluded.error,
          updated_at = CURRENT_TIMESTAMP
      `
    )
    .run(
      input.jobId,
      input.recipientAgent,
      input.recipientWalletId ?? null,
      input.recipientAddress,
      input.amountUnits,
      input.circleTransactionId ?? null,
      input.txHash ?? null,
      input.status ?? "pending",
      input.error ?? null
    );
}

export function listPayoutDistributions(input: {
  db: DatabaseConnection;
  jobId: string;
}): PayoutDistributionRecord[] {
  const rows = input.db.sqlite
    .prepare(
      `
        SELECT recipient_agent, recipient_wallet_id, recipient_address, amount_units,
               circle_transaction_id, tx_hash, status, error, updated_at
        FROM payout_distributions
        WHERE job_id = ?
        ORDER BY id ASC
      `
    )
    .all(input.jobId) as Array<{
      recipient_agent: string;
      recipient_wallet_id: string | null;
      recipient_address: string;
      amount_units: string | number;
      circle_transaction_id: string | null;
      tx_hash: string | null;
      status: string;
      error: string | null;
      updated_at: string;
    }>;

  return rows.map(mapPayoutRow);
}
