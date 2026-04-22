import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import {
  connectDatabase,
  logAgentEvent,
  saveStoredReport,
  upsertJobInput,
  upsertJobRuntimeState
} from "@biomed/db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(repoRoot, ".env.local"), override: true });

type DemoTask = {
  jobId: string;
  diseaseName: string;
  rawQuery: string;
  normalizedQuery: string;
  userType: string;
  status: string;
  budgetUnits: string;
};

type DemoEvent = {
  agentName: string;
  eventType?: string;
  message: string;
  targetAgent?: string | null;
  details?: Record<string, unknown> | null;
};

function readJsonFile<T>(relativePath: string): T {
  const filePath = path.join(repoRoot, relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function clearExistingDemoState(jobId: string) {
  const db = connectDatabase();
  const deleteTables = [
    "agent_events",
    "agent_ledger_entries",
    "job_budget_snapshots",
    "job_funding_transactions",
    "payout_distributions",
    "job_inputs",
    "job_runtime_state"
  ];

  for (const tableName of deleteTables) {
    db.sqlite.prepare(`DELETE FROM ${tableName} WHERE job_id = ?`).run(jobId);
  }

  const reportsDir = process.env.BIOMED_REPORTS_DIR?.trim()
    ? path.isAbsolute(process.env.BIOMED_REPORTS_DIR)
      ? process.env.BIOMED_REPORTS_DIR
      : path.join(repoRoot, process.env.BIOMED_REPORTS_DIR)
    : path.join(repoRoot, "reports");
  const reportPath = path.join(reportsDir, `${jobId}.json`);
  if (fs.existsSync(reportPath)) {
    fs.unlinkSync(reportPath);
  }

  return db;
}

function main() {
  const task = readJsonFile<DemoTask>("examples/sample-task.json");
  const events = readJsonFile<DemoEvent[]>("examples/sample-events.json");
  const reportPayload = readJsonFile<Record<string, unknown>>("examples/sample-report.json");

  const db = clearExistingDemoState(task.jobId);

  upsertJobInput({
    db,
    jobId: task.jobId,
    diseaseName: task.diseaseName,
    rawQuery: task.rawQuery,
    normalizedQuery: task.normalizedQuery,
    userType: task.userType
  });

  upsertJobRuntimeState({
    db,
    jobId: task.jobId,
    status: task.status,
    budgetUnits: BigInt(task.budgetUnits)
  });

  for (const event of events) {
    logAgentEvent({
      db,
      jobId: task.jobId,
      agentName: event.agentName,
      eventType: event.eventType ?? "info",
      message: event.message,
      targetAgent: event.targetAgent ?? null,
      details: event.details ?? null
    });
  }

  const reportPath = saveStoredReport(task.jobId, reportPayload);

  console.log(`[seed:demo] seeded job ${task.jobId}`);
  console.log(`[seed:demo] database: ${db.filename}`);
  console.log(`[seed:demo] report: ${reportPath}`);
  console.log("[seed:demo] open http://localhost:3000/workspace/demo-ipf-001");
  console.log("[seed:demo] open http://localhost:3000/results/demo-ipf-001");
}

main();
