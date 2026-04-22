import type { DatabaseConnection } from "../client/database.js";

export interface AgentEventRecord {
  id: number;
  agentName: string;
  eventType: string;
  message: string;
  targetAgent: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export function logAgentEvent(input: {
  db: DatabaseConnection;
  jobId: string;
  agentName: string;
  message: string;
  eventType?: string;
  targetAgent?: string | null;
  details?: Record<string, unknown> | null;
}): void {
  input.db.sqlite
    .prepare(
      `
        INSERT INTO agent_events (job_id, agent_name, event_type, message, target_agent, details_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      input.jobId,
      input.agentName,
      input.eventType ?? "info",
      input.message,
      input.targetAgent ?? null,
      input.details ? JSON.stringify(input.details) : null
    );
}

export function getAgentEvents(input: {
  db: DatabaseConnection;
  jobId: string;
  sinceId?: number;
}): AgentEventRecord[] {
  const rows = input.db.sqlite
    .prepare(
      `
        SELECT id, agent_name, event_type, message, target_agent, details_json, created_at
        FROM agent_events
        WHERE job_id = ? AND id > ?
        ORDER BY id ASC
      `
    )
    .all(input.jobId, input.sinceId ?? 0) as Array<{
      id: number;
      agent_name: string;
      event_type: string;
      message: string;
      target_agent: string | null;
      details_json: string | null;
      created_at: string;
    }>;

  return rows.map((row) => ({
    id: row.id,
    agentName: row.agent_name,
    eventType: row.event_type,
    message: row.message,
    targetAgent: row.target_agent,
    details: row.details_json ? (JSON.parse(row.details_json) as Record<string, unknown>) : null,
    createdAt: row.created_at
  }));
}
