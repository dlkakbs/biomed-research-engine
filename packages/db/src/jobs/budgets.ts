import type { DatabaseConnection } from "../client/database.js";

export function upsertJobBudgetSnapshot(input: {
  db: DatabaseConnection;
  jobId: string;
  budgetUnits: bigint;
}): void {
  input.db.sqlite
    .prepare(
      `
        INSERT INTO job_budget_snapshots (job_id, budget_units, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(job_id) DO UPDATE SET
          budget_units = excluded.budget_units,
          updated_at = CURRENT_TIMESTAMP
      `
    )
    .run(input.jobId, input.budgetUnits.toString());
}

export function getJobBudgetSnapshot(input: {
  db: DatabaseConnection;
  jobId: string;
}): bigint {
  const row = input.db.sqlite
    .prepare(
      `
        SELECT budget_units
        FROM job_budget_snapshots
        WHERE job_id = ?
      `
    )
    .get(input.jobId) as { budget_units: string | number } | undefined;

  return row ? BigInt(row.budget_units) : 0n;
}
