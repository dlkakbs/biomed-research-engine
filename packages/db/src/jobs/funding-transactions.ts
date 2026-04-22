import type { DatabaseConnection } from "../client/database.js";

export interface JobFundingTransactionRecord {
  jobId: string;
  txType: string;
  txHash: string;
  txStatus: string;
  walletAddress: string | null;
  amountUnits: string | null;
  chainId: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

function mapFundingRow(row: {
  job_id: string;
  tx_type: string;
  tx_hash: string;
  tx_status: string;
  wallet_address: string | null;
  amount_units: string | null;
  chain_id: number | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}): JobFundingTransactionRecord {
  return {
    jobId: row.job_id,
    txType: row.tx_type,
    txHash: row.tx_hash,
    txStatus: row.tx_status,
    walletAddress: row.wallet_address,
    amountUnits: row.amount_units,
    chainId: row.chain_id,
    metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function upsertJobFundingTransaction(input: {
  db: DatabaseConnection;
  jobId: string;
  txType: string;
  txHash: string;
  txStatus?: string;
  walletAddress?: string | null;
  amountUnits?: string | null;
  chainId?: number | null;
  metadata?: Record<string, unknown> | null;
}): void {
  input.db.sqlite
    .prepare(
      `
        INSERT INTO job_funding_transactions (
          job_id, tx_type, tx_hash, tx_status, wallet_address, amount_units, chain_id, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(job_id, tx_type) DO UPDATE SET
          tx_hash = excluded.tx_hash,
          tx_status = excluded.tx_status,
          wallet_address = excluded.wallet_address,
          amount_units = excluded.amount_units,
          chain_id = excluded.chain_id,
          metadata_json = excluded.metadata_json,
          updated_at = CURRENT_TIMESTAMP
      `
    )
    .run(
      input.jobId,
      input.txType,
      input.txHash,
      input.txStatus ?? "submitted",
      input.walletAddress ?? null,
      input.amountUnits ?? null,
      input.chainId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null
    );
}

export function listJobFundingTransactions(input: {
  db: DatabaseConnection;
  jobId: string;
}): JobFundingTransactionRecord[] {
  const rows = input.db.sqlite
    .prepare(
      `
        SELECT job_id, tx_type, tx_hash, tx_status, wallet_address, amount_units, chain_id, metadata_json, created_at, updated_at
        FROM job_funding_transactions
        WHERE job_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(input.jobId) as Array<{
      job_id: string;
      tx_type: string;
      tx_hash: string;
      tx_status: string;
      wallet_address: string | null;
      amount_units: string | null;
      chain_id: number | null;
      metadata_json: string | null;
      created_at: string;
      updated_at: string;
    }>;

  return rows.map(mapFundingRow);
}
