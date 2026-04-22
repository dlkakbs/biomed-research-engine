import type { DatabaseConnection } from "../client/database.js";

export interface JobRuntimeState {
  jobId: string;
  status: string;
  budgetUnits: bigint;
  updatedAt: string;
}

export function upsertJobRuntimeState(input: {
  db: DatabaseConnection;
  jobId: string;
  status: string;
  budgetUnits?: bigint;
}): void {
  input.db.sqlite
    .prepare(
      `
        INSERT INTO job_runtime_state (job_id, status, budget_units, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(job_id) DO UPDATE SET
          status = excluded.status,
          budget_units = excluded.budget_units,
          updated_at = CURRENT_TIMESTAMP
      `
    )
    .run(input.jobId, input.status, (input.budgetUnits ?? 0n).toString());
}

export function getJobRuntimeState(input: {
  db: DatabaseConnection;
  jobId: string;
}): JobRuntimeState | null {
  const row = input.db.sqlite
    .prepare(
      `
        SELECT job_id, status, budget_units, updated_at
        FROM job_runtime_state
        WHERE job_id = ?
      `
    )
    .get(input.jobId) as
    | {
        job_id: string;
        status: string;
        budget_units: string | number;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;

  return {
    jobId: row.job_id,
    status: row.status,
    budgetUnits: BigInt(row.budget_units),
    updatedAt: row.updated_at
  };
}
