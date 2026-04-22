import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  pragma(statement: string): unknown;
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatement;
}

type SqliteConstructor = new (filename: string) => SqliteDatabase;

const require = createRequire(import.meta.url);
const BetterSqlite3 = require("better-sqlite3") as SqliteConstructor;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../../");

export interface DatabaseConnection {
  readonly driver: "sqlite";
  readonly filename: string;
  readonly sqlite: SqliteDatabase;
}

function resolveDatabasePath(): string {
  const configuredPath = process.env.BIOMED_DB_PATH?.trim() || "biomed_research.sqlite3";
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(REPO_ROOT, configuredPath);
}

function ensureColumn(sqlite: SqliteDatabase, tableName: string, columnName: string, definition: string): void {
  const rows = sqlite
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name?: string }>;
  const hasColumn = rows.some((row) => row.name === columnName);
  if (!hasColumn) {
    sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function initializeSchema(sqlite: SqliteDatabase): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS job_runtime_state (
      job_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      budget_units INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      target_agent TEXT,
      details_json TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS agent_ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      status TEXT NOT NULL,
      base_cost REAL NOT NULL,
      contribution_weight REAL NOT NULL,
      risk_weight REAL NOT NULL,
      payout_weight REAL NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS job_budget_snapshots (
      job_id TEXT PRIMARY KEY,
      budget_units INTEGER NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS job_inputs (
      job_id TEXT PRIMARY KEY,
      disease_name TEXT,
      raw_query TEXT,
      normalized_query TEXT NOT NULL,
      user_type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payout_distributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      recipient_agent TEXT NOT NULL,
      recipient_wallet_id TEXT,
      recipient_address TEXT NOT NULL,
      amount_units INTEGER NOT NULL,
      circle_transaction_id TEXT,
      tx_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(job_id, recipient_agent)
    );

    CREATE TABLE IF NOT EXISTS job_funding_transactions (
      job_id TEXT NOT NULL,
      tx_type TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      tx_status TEXT NOT NULL DEFAULT 'submitted',
      wallet_address TEXT,
      amount_units TEXT,
      chain_id INTEGER,
      metadata_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (job_id, tx_type)
    );
  `);

  ensureColumn(sqlite, "agent_events", "details_json", "TEXT");
  ensureColumn(sqlite, "job_funding_transactions", "metadata_json", "TEXT");
}

export function connectDatabase(filename = resolveDatabasePath()): DatabaseConnection {
  const sqlite = new BetterSqlite3(filename);
  initializeSchema(sqlite);

  return {
    driver: "sqlite",
    filename,
    sqlite
  };
}
