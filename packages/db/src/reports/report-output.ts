import fs from "node:fs";
import path from "node:path";

export interface StoredReportPayload {
  agent?: string;
  status?: string;
  report?: Record<string, unknown>;
  [key: string]: unknown;
}

function resolveReportsDir(): string {
  return process.env.BIOMED_REPORTS_DIR ?? "reports";
}

export function getStoredReport(jobId: string): StoredReportPayload | null {
  const filePath = path.join(resolveReportsDir(), `${jobId}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as StoredReportPayload;
}

export function saveStoredReport(jobId: string, payload: StoredReportPayload): string {
  const reportsDir = resolveReportsDir();
  fs.mkdirSync(reportsDir, { recursive: true });
  const filePath = path.join(reportsDir, `${jobId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}
