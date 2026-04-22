import type { DatabaseConnection } from "../client/database.js";

export interface JobInputRecord {
  jobId: string;
  diseaseName: string;
  rawQuery: string;
  normalizedQuery: string;
  userType: string;
  createdAt: string;
  updatedAt: string;
}

export function upsertJobInput(input: {
  db: DatabaseConnection;
  jobId: string;
  diseaseName?: string;
  rawQuery?: string;
  normalizedQuery: string;
  userType?: string;
}): void {
  input.db.sqlite
    .prepare(
      `
        INSERT INTO job_inputs (job_id, disease_name, raw_query, normalized_query, user_type, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(job_id) DO UPDATE SET
          disease_name = excluded.disease_name,
          raw_query = excluded.raw_query,
          normalized_query = excluded.normalized_query,
          user_type = excluded.user_type,
          updated_at = CURRENT_TIMESTAMP
      `
    )
    .run(
      input.jobId,
      input.diseaseName?.trim() || "",
      input.rawQuery?.trim() || "",
      input.normalizedQuery.trim(),
      input.userType?.trim() || ""
    );
}

export function getJobInput(input: {
  db: DatabaseConnection;
  jobId: string;
}): JobInputRecord | null {
  const row = input.db.sqlite
    .prepare(
      `
        SELECT job_id, disease_name, raw_query, normalized_query, user_type, created_at, updated_at
        FROM job_inputs
        WHERE job_id = ?
      `
    )
    .get(input.jobId) as
    | {
        job_id: string;
        disease_name: string | null;
        raw_query: string | null;
        normalized_query: string;
        user_type: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) return null;

  return {
    jobId: row.job_id,
    diseaseName: row.disease_name ?? "",
    rawQuery: row.raw_query ?? "",
    normalizedQuery: row.normalized_query,
    userType: row.user_type ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
