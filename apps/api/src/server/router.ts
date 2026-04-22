import type { DatabaseConnection } from "@biomed/db";
import {
  getAgentEvents,
  getJobInput,
  getJobBudgetSnapshot,
  getJobRuntimeState,
  getStoredReport,
  logAgentEvent,
  upsertJobFundingTransaction,
  upsertJobInput,
  upsertJobRuntimeState,
  upsertJobBudgetSnapshot
} from "@biomed/db";
import { runResearchPipeline } from "@biomed/orchestration";
import {
  finalizeErc8183Job,
  getErc8183Job,
  inspectErc8183SignerConfig,
  setErc8183Budget
} from "@biomed/payments";
import { getSupportedX402Kinds, settleX402Envelope, verifyX402Envelope } from "./debug/x402.js";
import { createPaidResourceResponse } from "./paid-resources.js";

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });
}

function notImplemented(name: string) {
  return json(
    {
      error: "not_implemented",
      detail: `${name} is not implemented yet`
    },
    { status: 501 }
  );
}

function buildLifecycleDetails(input: {
  txType: string;
  txHash: string;
  transactionId?: string;
  refId?: string;
  walletId?: string;
  amountUnits?: string;
}) {
  return {
    kind: "lifecycle_tx",
    txType: input.txType,
    txHash: input.txHash,
    circleTransactionId: input.transactionId,
    refId: input.refId,
    walletId: input.walletId,
    amountUnits: input.amountUnits,
    chainId: 5042002,
    status: "success"
  };
}

function buildPipelineFailureUserMessage(error: unknown): string {
  const text = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  const lowered = text.toLowerCase();

  if (lowered.includes("pubmed search did not respond in time")) {
    return "The pipeline stopped at the literature stage because PubMed search did not respond in time. No report was delivered, and the escrow was refunded.";
  }
  if (lowered.includes("paper details did not load in time")) {
    return "The pipeline stopped at the literature stage because PubMed paper details did not load in time. No report was delivered, and the escrow was refunded.";
  }
  if (lowered.includes("citation enrichment service did not respond in time")) {
    return "The pipeline stopped at the literature stage because citation ranking did not respond in time. No report was delivered, and the escrow was refunded.";
  }
  if (lowered.includes("external medical literature service took too long to respond")) {
    return "The pipeline stopped at the literature stage because an external literature service took too long to respond. No report was delivered, and the escrow was refunded.";
  }
  if (lowered.includes("literature screening stopped") || lowered.includes("literature search could not start")) {
    return "The pipeline stopped at the literature stage before a usable paper set was returned. No report was delivered, and the escrow was refunded.";
  }
  if (lowered.includes("chembl returned 500")) {
    return "The pipeline stopped at the DrugDB stage because the ChEMBL target service returned a server error. No report was delivered, and the escrow was refunded.";
  }
  if (lowered.includes("chembl returned 400")) {
    return "The pipeline stopped at the DrugDB stage because the ChEMBL target service rejected the current disease query format. No report was delivered, and the escrow was refunded.";
  }
  if (lowered.includes("drugdb target lookup stopped")) {
    return "The pipeline stopped at the DrugDB stage before drug-target screening finished. No report was delivered, and the escrow was refunded.";
  }
  return text || "The pipeline stopped before delivery because the run failed an internal processing step.";
}

export function createApiRouter(db: DatabaseConnection) {
  async function runPipelineInBackground(input: {
    jobId: string;
    query: string;
    diseaseName?: string;
    rawQuery?: string;
    userType: "researcher";
    budgetUnits: bigint;
  }) {
    const { jobId, query, diseaseName, rawQuery, userType, budgetUnits } = input;

    try {
      const report = await runResearchPipeline({
        db,
        jobId,
        query,
        diseaseName,
        rawQuery,
        userType
      });

      logAgentEvent({
        db,
        jobId,
        agentName: "pi",
        eventType: "info",
        message: "Pipeline completed and the report package is ready."
      });
    } catch (error) {
      let refunded = false;
      try {
        const onchainJob = await getErc8183Job(jobId);
        if (onchainJob && (onchainJob.status === "Funded" || onchainJob.status === "Submitted")) {
          const rejectReason =
            error instanceof Error && error.message.trim()
              ? `pipeline_failed:${error.message}`
              : "pipeline_failed:unknown";
          const rejectResult = await finalizeErc8183Job({
            jobId,
            approved: false,
            reason: rejectReason
          });
          upsertJobFundingTransaction({
            db,
            jobId,
            txType: "pipeline_refund",
            txHash: rejectResult.txHash,
            txStatus: "success",
            chainId: 5042002,
            metadata: buildLifecycleDetails({
              txType: "pipeline_refund",
              txHash: rejectResult.txHash,
              transactionId: rejectResult.transactionId,
              refId: rejectResult.refId,
              walletId: rejectResult.walletId
            })
          });
          logAgentEvent({
            db,
            jobId,
            agentName: "pi",
            eventType: "payment",
            message:
              `Pipeline refund executed on ERC-8183 tx=${rejectResult.txHash}` +
              ` circle_tx=${rejectResult.transactionId}` +
              ` ref=${rejectResult.refId}` +
              ` wallet=${rejectResult.walletId}`,
            details: buildLifecycleDetails({
              txType: "pipeline_refund",
              txHash: rejectResult.txHash,
              transactionId: rejectResult.transactionId,
              refId: rejectResult.refId,
              walletId: rejectResult.walletId
            })
          });
          refunded = true;
        }
      } catch (rejectError) {
        logAgentEvent({
          db,
          jobId,
          agentName: "pi",
          eventType: "error",
          message:
            `Automatic refund finalization failed after pipeline error: ` +
            `${rejectError instanceof Error ? rejectError.message : "unknown"}`
        });
      }
      upsertJobRuntimeState({
        db,
        jobId,
        status: refunded ? "Rejected" : "Failed",
        budgetUnits
      });
      logAgentEvent({
        db,
        jobId,
        agentName: "pi",
        eventType: "error",
        message: buildPipelineFailureUserMessage(error)
      });
    }
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    if (method === "POST" && pathname.startsWith("/api/paid/")) {
      const paymentHeader = request.headers.get("payment-signature");
      const payload = await request.json().catch(() => null);
      const paidResponse = await createPaidResourceResponse({
        pathname,
        paymentHeader,
        payload
      });

      if (paidResponse) {
        return paidResponse;
      }
    }

    if (method === "GET" && pathname === "/") {
      return json({
        ok: true,
        service: "biomed-api",
        message: "API server is running. Open the web app for the UI.",
        ui_url: "http://localhost:3000",
        health_url: "/health",
        primary_routes: [
          "/api/run",
          "/api/reports/:jobId",
          "/api/jobs/:jobId/funding",
          "/api/jobs/:jobId/escrow",
          "/api/workspace/events?job_id=:jobId"
        ]
      });
    }

    if (method === "GET" && pathname === "/health") {
      return json({ ok: true, service: "biomed-api" });
    }

    if (method === "GET" && pathname === "/api/debug/x402/supported") {
      try {
        const supported = await getSupportedX402Kinds();
        return json(supported);
      } catch (error) {
        return json(
          {
            error: "x402_supported_failed",
            detail: error instanceof Error ? error.message : "unknown"
          },
          { status: 500 }
        );
      }
    }

    if (method === "GET" && pathname === "/api/debug/circle/erc8183-signers") {
      try {
        const signerConfig = await inspectErc8183SignerConfig();
        return json({
          ok: true,
          signers: signerConfig
        });
      } catch (error) {
        return json(
          {
            error: "circle_signer_inspect_failed",
            detail: error instanceof Error ? error.message : "unknown"
          },
          { status: 500 }
        );
      }
    }

    if (method === "POST" && pathname === "/api/debug/x402/verify") {
      try {
        const body = (await request.json()) as {
          paymentPayload: {
            x402Version: number;
            accepted: {
              scheme: string;
              network: string;
              asset: string;
              amount: string;
              payTo: string;
              maxTimeoutSeconds?: number;
              extra?: Record<string, unknown>;
            };
            payload: Record<string, unknown>;
            resource: {
              url: string;
              description?: string;
              mimeType?: string;
            };
            extensions?: Record<string, unknown>;
          };
          paymentRequirements: {
            scheme: string;
            network: string;
            asset: string;
            amount: string;
            payTo: string;
            maxTimeoutSeconds?: number;
            extra?: Record<string, unknown>;
          };
        };

        const result = await verifyX402Envelope(body);
        return json(result);
      } catch (error) {
        return json(
          {
            error: "x402_verify_failed",
            detail: error instanceof Error ? error.message : "unknown"
          },
          { status: 500 }
        );
      }
    }

    if (method === "POST" && pathname === "/api/debug/x402/settle") {
      try {
        const body = (await request.json()) as {
          paymentPayload: {
            x402Version: number;
            accepted: {
              scheme: string;
              network: string;
              asset: string;
              amount: string;
              payTo: string;
              maxTimeoutSeconds?: number;
              extra?: Record<string, unknown>;
            };
            payload: Record<string, unknown>;
            resource: string | { url: string; description?: string; mimeType?: string };
            extensions?: Record<string, unknown>;
          };
          paymentRequirements: {
            scheme: string;
            network: string;
            asset: string;
            amount: string;
            payTo: string;
            maxTimeoutSeconds?: number;
            extra?: Record<string, unknown>;
          };
        };

        const result = await settleX402Envelope(body);
        return json(result);
      } catch (error) {
        return json(
          {
            error: "x402_settle_failed",
            detail: error instanceof Error ? error.message : "unknown"
          },
          { status: 500 }
        );
      }
    }

    if (method === "POST" && pathname === "/api/run") {
      const body = (await request.json()) as Record<string, unknown>;
      const jobId = String(body.job_id ?? body.jobId ?? "");
      const diseaseName = String(body.disease ?? "").trim();
      const rawQuery = String(body.query ?? body.prompt ?? "");
      const query = diseaseName || rawQuery || "glioblastoma";
      const userType = "researcher" as const;

      if (!jobId) {
        return json({ error: "job_id_required" }, { status: 400 });
      }

      upsertJobInput({
        db,
        jobId,
        diseaseName,
        rawQuery,
        normalizedQuery: query,
        userType
      });

      const runtime = getJobRuntimeState({ db, jobId });
      const budgetUnits = runtime?.budgetUnits ?? getJobBudgetSnapshot({ db, jobId });
      try {
        const onchainJob = await getErc8183Job(jobId);
        if (onchainJob) {
          if (onchainJob.status === "Expired") {
            upsertJobRuntimeState({
              db,
              jobId,
              status: "Expired",
              budgetUnits: BigInt(onchainJob.budget)
            });
            return json(
              {
                error: "job_expired",
                detail: `Job ${jobId} is expired on-chain and cannot start the pipeline.`
              },
              { status: 409 }
            );
          }
          if (onchainJob.status !== "Funded" && onchainJob.status !== "Submitted") {
            return json(
              {
                error: "job_not_funded",
                detail: `Job ${jobId} must be Funded on ERC-8183 before running the pipeline. Current status=${onchainJob.status}.`
              },
              { status: 409 }
            );
          }
        }

        upsertJobRuntimeState({
          db,
          jobId,
          status: "Running",
          budgetUnits
        });

        logAgentEvent({
          db,
          jobId,
          agentName: "pi",
          eventType: "info",
          message: "Pipeline accepted and started in background."
        });

        void runPipelineInBackground({
          jobId,
          query,
          diseaseName,
          rawQuery,
          userType,
          budgetUnits
        });

        return json({
          ok: true,
          job_id: jobId,
          status: "started",
          user_type: userType,
          mode: "background"
        }, { status: 202 });
      } catch (error) {
        upsertJobRuntimeState({
          db,
          jobId,
          status: "Failed",
          budgetUnits
        });
        return json(
          {
            error: "pipeline_failed",
            detail: error instanceof Error ? error.message : "unknown"
          },
          { status: 500 }
        );
      }
    }

    const setBudgetMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/setbudget$/);
    if (method === "POST" && setBudgetMatch) {
      try {
        const jobId = decodeURIComponent(setBudgetMatch[1] ?? "");
        const fixedBudget = 3_000_000n;
        const onchainJob = await getErc8183Job(jobId);
        if (!onchainJob) {
          return json(
            {
              error: "job_not_found_onchain",
              detail: `Job ${jobId} was not found on ERC-8183.`
            },
            { status: 404 }
          );
        }
        if (onchainJob.status === "Expired") {
          upsertJobRuntimeState({ db, jobId, status: "Expired", budgetUnits: BigInt(onchainJob.budget) });
          return json(
            {
              error: "job_expired",
              detail: `Job ${jobId} is expired on-chain and cannot accept a new budget.`
            },
            { status: 409 }
          );
        }

        let budgetTxHash: string | null = null;
        if (BigInt(onchainJob.budget) === 0n) {
          const budgetResult = await setErc8183Budget(jobId, fixedBudget);
          budgetTxHash = budgetResult.txHash;
          upsertJobFundingTransaction({
            db,
            jobId,
            txType: "setbudget",
            txHash: budgetResult.txHash,
            txStatus: "success",
            chainId: 5042002,
            amountUnits: fixedBudget.toString(),
            metadata: buildLifecycleDetails({
              txType: "setbudget",
              txHash: budgetResult.txHash,
              transactionId: budgetResult.transactionId,
              refId: budgetResult.refId,
              walletId: budgetResult.walletId,
              amountUnits: fixedBudget.toString()
            })
          });
          logAgentEvent({
            db,
            jobId,
            agentName: "pi",
            eventType: "payment",
            message:
              `PI setBudget executed on ERC-8183 tx=${budgetResult.txHash}` +
              ` circle_tx=${budgetResult.transactionId}` +
              ` ref=${budgetResult.refId}` +
              ` wallet=${budgetResult.walletId}`,
            details: buildLifecycleDetails({
              txType: "setbudget",
              txHash: budgetResult.txHash,
              transactionId: budgetResult.transactionId,
              refId: budgetResult.refId,
              walletId: budgetResult.walletId,
              amountUnits: fixedBudget.toString()
            })
          });
        }

        upsertJobBudgetSnapshot({ db, jobId, budgetUnits: fixedBudget });
        upsertJobRuntimeState({
          db,
          jobId,
          status: "Open",
          budgetUnits: fixedBudget
        });
        logAgentEvent({
          db,
          jobId,
          agentName: "pi",
          eventType: "info",
          message: budgetTxHash
            ? "Budget set on-chain."
            : "On-chain budget already present; local budget snapshot synchronized."
        });
        return json({
          ok: true,
          job_id: jobId,
          budget_units: fixedBudget.toString(),
          tx_hash: budgetTxHash,
          source: "erc8183"
        });
      } catch (error) {
        return json(
          {
            error: "set_budget_failed",
            detail: error instanceof Error ? error.message : "unknown"
          },
          { status: 500 }
        );
      }
    }

    const fundingMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/funding$/);
    if (fundingMatch) {
      const jobId = decodeURIComponent(fundingMatch[1] ?? "");
      const runtime = getJobRuntimeState({ db, jobId });
      const budgetUnitsBig = runtime?.budgetUnits ?? getJobBudgetSnapshot({ db, jobId });
      const budgetUnits = budgetUnitsBig.toString();

      if (method === "GET") {
        const onchainJob = await getErc8183Job(jobId);
        if (onchainJob) {
          upsertJobBudgetSnapshot({ db, jobId, budgetUnits: BigInt(onchainJob.budget) });
          upsertJobRuntimeState({
            db,
            jobId,
            status: onchainJob.status,
            budgetUnits: BigInt(onchainJob.budget)
          });
        }
        return json({
          job_id: jobId,
          transactions: [],
          onchain_job: {
            status: onchainJob?.status ?? runtime?.status ?? (Number(budgetUnits) > 0 ? "Open" : "Draft"),
            budget: onchainJob?.budget ?? budgetUnits,
            client: onchainJob?.client,
            provider: onchainJob?.provider,
            evaluator: onchainJob?.evaluator
          },
          source: onchainJob ? "erc8183" : "local_state"
        });
      }

      if (method === "POST") {
        const onchainJob = await getErc8183Job(jobId);
        upsertJobRuntimeState({
          db,
          jobId,
          status: onchainJob?.status ?? "Funded",
          budgetUnits: onchainJob ? BigInt(onchainJob.budget) : budgetUnitsBig
        });
        logAgentEvent({
          db,
          jobId,
          agentName: "pi",
          eventType: "payment",
          message: onchainJob?.status === "Funded"
            ? "Funding confirmed on ERC-8183."
            : `Funding sync requested, current on-chain status=${onchainJob?.status ?? "unknown"}.`
        });
        return json({
          ok: true,
          job_id: jobId,
          status: onchainJob?.status?.toLowerCase() ?? "funded",
          source: onchainJob ? "erc8183" : "local_state"
        });
      }
    }

    const inputMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/input$/);
    if (method === "GET" && inputMatch) {
      const jobId = decodeURIComponent(inputMatch[1] ?? "");
      const inputRecord = getJobInput({ db, jobId });
      if (!inputRecord) {
        return json(
          {
            error: "job_input_not_found",
            detail: `No stored job input was found for ${jobId}.`
          },
          { status: 404 }
        );
      }
      return json({
        job_id: inputRecord.jobId,
        disease_name: inputRecord.diseaseName,
        raw_query: inputRecord.rawQuery,
        normalized_query: inputRecord.normalizedQuery,
        user_type: inputRecord.userType,
        created_at: inputRecord.createdAt,
        updated_at: inputRecord.updatedAt
      });
    }

    const escrowMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/escrow$/);
    if (method === "GET" && escrowMatch) {
      const jobId = decodeURIComponent(escrowMatch[1] ?? "");
      const runtime = getJobRuntimeState({ db, jobId });
      const onchainJob = await getErc8183Job(jobId);
      const budgetUnits = onchainJob ? BigInt(onchainJob.budget) : runtime?.budgetUnits ?? getJobBudgetSnapshot({ db, jobId });
      const status = onchainJob?.status ?? runtime?.status ?? (budgetUnits > 0n ? "Open" : "Draft");
      return json({
        status,
        escrow_state:
          status === "Completed"
            ? "settled_to_pi"
            : status === "Rejected"
              ? "refunded"
              : status === "Expired"
                ? "refund_pending"
                : status === "Submitted"
                  ? "submitted"
                  : status === "Funded"
            ? "funded"
            : budgetUnits > 0n
              ? "awaiting_fund"
              : "not_ready",
        headline:
          status === "Completed"
            ? "Delivery completed"
            : status === "Rejected"
              ? "Escrow refunded"
              : status === "Expired"
                ? "Job expired"
                : status === "Submitted"
                  ? "Awaiting final review settlement"
                  : status === "Funded"
            ? "Escrow funded"
            : budgetUnits > 0n
              ? "Budget prepared"
              : "Budget not prepared",
        detail:
          status === "Completed"
            ? "Report approved and delivered."
            : status === "Rejected"
              ? "The report was rejected and the budget was refunded."
              : status === "Expired"
                ? "This job expired before completion. If the refund did not finalize automatically, a refund claim is still required."
                : status === "Submitted"
                  ? "The provider submitted the deliverable and final review settlement is still pending."
                  : status === "Funded"
            ? "The escrow is funded and the pipeline is in progress."
            : budgetUnits > 0n
            ? "The budget is set and the client can now fund the escrow."
            : "No on-chain budget has been set for this job yet."
      });
    }

    const reportMatch = pathname.match(/^\/api\/reports\/([^/]+)$/);
    if (method === "GET" && reportMatch) {
      const jobId = decodeURIComponent(reportMatch[1] ?? "");
      const reportData = getStoredReport(jobId);
      if (!reportData) {
        return json(
          {
            error: "report_not_available",
            detail: `Report loading for job ${jobId} is not implemented yet.`
          },
          { status: 404 }
        );
      }

      return json({
        ...reportData,
        provenance: {
          source: "report_file",
          mode: "compat"
        }
      });
    }

    if (method === "GET" && pathname === "/api/workspace/events") {
      const jobId = url.searchParams.get("job_id");
      const sinceId = Number(url.searchParams.get("since_id") ?? "0");
      if (!jobId) {
        return json({ error: "job_id_required" }, { status: 400 });
      }

      const events = getAgentEvents({ db, jobId, sinceId });
      const runtime = getJobRuntimeState({ db, jobId });
      const reportData = getStoredReport(jobId);
      const normalizedStatus = String(runtime?.status ?? "").toLowerCase();
      return json({
        events: events.map((event) => ({
          id: event.id,
          agent_name: event.agentName,
          event_type: event.eventType,
          message: event.message,
          target_agent: event.targetAgent ?? undefined,
          created_at: event.createdAt
        })),
        job_status:
          normalizedStatus === "completed" || normalizedStatus === "rejected"
            ? "complete"
            : normalizedStatus === "failed" || normalizedStatus === "error"
              ? "failed"
              : runtime || reportData
                ? "running"
                : "pending"
      });
    }

    return notImplemented(`${method} ${pathname}`);
  };
}
