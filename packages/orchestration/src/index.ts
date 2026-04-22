import type { DatabaseConnection } from "@biomed/db";
import type { PaymentSystem } from "@biomed/payments";
export * from "./pipeline.js";

export interface Orchestrator {
  name: "biomed-research";
  db: DatabaseConnection;
  payments: PaymentSystem;
}

export function createOrchestrator(input: {
  db: DatabaseConnection;
  payments: PaymentSystem;
}): Orchestrator {
  return {
    name: "biomed-research",
    db: input.db,
    payments: input.payments
  };
}
