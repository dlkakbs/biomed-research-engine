import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { createOrchestrator } from "@biomed/orchestration";
import { createPaymentSystem } from "@biomed/payments";
import { connectDatabase } from "@biomed/db";
import { createHttpServer } from "./server/http.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env.local"), override: true });

async function main() {
  const db = connectDatabase();
  const payments = createPaymentSystem();
  const orchestrator = createOrchestrator({ db, payments });
  const port = Number(process.env.API_PORT ?? "3001");
  const server = createHttpServer(db);

  console.log("[api] BioMed Research API ready");
  console.log(`[api] payment mode: ${payments.mode}`);
  console.log(`[api] orchestrator: ${orchestrator.name}`);
  server.listen(port, () => {
    console.log(`[api] listening on http://localhost:${port}`);
  });
}

void main();
