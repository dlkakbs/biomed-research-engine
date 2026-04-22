import {
  insertAgentLedgerEntry,
  logAgentEvent,
  saveStoredReport,
  upsertJobFundingTransaction,
  upsertJobRuntimeState,
  type DatabaseConnection,
  type StoredReportPayload
} from "@biomed/db";
import {
  runDrugdbFetch,
  runEvaluatorReview,
  runLiteratureSearch,
  runPathwayAnalysisPaid,
  runRepurposingAnalysis,
  runEvidenceScoring,
  runRedTeamReview
} from "@biomed/agents";
import { buildReportPayload, runReportSafetyChecks, type JsonRecord } from "./report-heuristics.js";
import { enhanceReportNarrative } from "./report-llm.js";
import type { PaidServiceResponse } from "@biomed/payments";
import { finalizeErc8183Job, getErc8183Job, submitErc8183Job } from "@biomed/payments";
import { distributeInternalPayouts } from "./internal-payouts.js";

const CONTRIBUTION_WEIGHTS: Record<string, number> = {
  literature: 5,
  drugdb: 3,
  pathway: 3,
  repurposing: 5,
  evidence: 4,
  red_team: 2,
  report: 2
};

const RISK_WEIGHTS: Record<string, number> = {
  literature: 2,
  drugdb: 1,
  pathway: 1,
  repurposing: 2,
  evidence: 2,
  red_team: 2,
  report: 1
};

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : {};
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatUsdcAtomic(amount: string | undefined): string | undefined {
  if (!amount || !/^\d+$/.test(amount)) return undefined;
  const units = BigInt(amount);
  const whole = units / 1_000_000n;
  const fraction = units % 1_000_000n;
  return `${whole}.${fraction.toString().padStart(6, "0")}`;
}

function buildLiteratureFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const lowered = text.toLowerCase();

  if (lowered.includes("pubmed search failed")) {
    return "Literature search could not start because PubMed search did not respond in time.";
  }
  if (lowered.includes("pubmed fetch failed")) {
    return "Literature screening stopped because PubMed returned IDs but the paper details did not load in time.";
  }
  if (lowered.includes("openalex")) {
    return "Literature screening stopped because the citation enrichment service did not respond in time.";
  }
  if (lowered.includes("timed out") || lowered.includes("timeout") || lowered.includes("aborted")) {
    return "Literature screening stopped because an external medical literature service took too long to respond.";
  }
  return "Literature screening stopped before returning a result because an external literature service failed.";
}

function buildDrugdbFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const lowered = text.toLowerCase();

  if (lowered.includes("chembl returned 500")) {
    return "DrugDB target lookup stopped because the ChEMBL target service returned a server error.";
  }
  if (lowered.includes("chembl returned 400")) {
    return "DrugDB target lookup stopped because the ChEMBL target service rejected the disease query format for this pass.";
  }
  if (lowered.includes("timed out") || lowered.includes("timeout") || lowered.includes("aborted")) {
    return "DrugDB target lookup stopped because an external target service took too long to respond.";
  }
  return "DrugDB failed before returning a result because an external drug intelligence service failed.";
}

function assertReportSafety(stage: string, jobId: string, reportPayload: ReturnType<typeof buildReportPayload>) {
  const issues = runReportSafetyChecks(reportPayload);
  if (issues.length > 0) {
    throw new Error(`${stage}_report_safety_failed:${jobId}:${issues.join("; ")}`);
  }
}

function buildPaymentProof(
  agent: string,
  response: PaidServiceResponse<Record<string, unknown>>
): {
  agent: string;
  endpoint?: string;
  mode?: string;
  seller?: string;
  payer?: string;
  network?: string;
  transaction?: string;
  settled?: boolean;
  nonce?: string;
  amountAtomic?: string;
  amountUsdc?: string;
  validAfter?: string;
  validBefore?: string;
  resourceUrl?: string;
  buyerWalletId?: string;
} | null {
  const transaction = response.paymentResponse?.transaction ?? response.verification?.transaction;
  if (!transaction) return null;
  return {
    agent,
    endpoint: response.endpoint,
    mode: response.paymentResponse?.mode,
    seller: response.seller,
    payer: response.paymentResponse?.payer ?? response.verification?.payer,
    network: response.paymentResponse?.network ?? response.verification?.network,
    transaction,
    settled: response.paymentResponse?.settled ?? response.verification?.status === "verified",
    nonce: response.authorization?.nonce,
    amountAtomic: response.authorization?.amount,
    amountUsdc: formatUsdcAtomic(response.authorization?.amount),
    validAfter: response.authorization?.validAfter,
    validBefore: response.authorization?.validBefore,
    resourceUrl: response.authorization?.resourceUrl,
    buyerWalletId: response.authorization?.buyerWalletId
  };
}

function buildPaymentEventMessage(
  label: string,
  response: PaidServiceResponse<Record<string, unknown>>,
  fallback: string
): string {
  const proof = buildPaymentProof(label.toLowerCase(), response);
  if (!proof?.transaction) return fallback;
  const parts = [
    `${label} nanopayment verified through Gateway`,
    `tx=${proof.transaction}`
  ];
  if (proof.network) parts.push(`network=${proof.network}`);
  if (proof.payer) parts.push(`payer=${proof.payer}`);
  if (proof.seller) parts.push(`seller=${proof.seller}`);
  return parts.join(" ");
}

function buildCircleLifecycleMessage(input: {
  prefix: string;
  txHash: string;
  transactionId?: string;
  refId?: string;
  walletId?: string;
}): string {
  const parts = [input.prefix, `tx=${input.txHash}`];
  if (input.transactionId) parts.push(`circle_tx=${input.transactionId}`);
  if (input.refId) parts.push(`ref=${input.refId}`);
  if (input.walletId) parts.push(`wallet=${input.walletId}`);
  return parts.join(" ");
}

function buildLifecycleDetails(input: {
  txType: string;
  txHash: string;
  transactionId?: string;
  refId?: string;
  walletId?: string;
  amountUnits?: string;
  chainId?: number;
  status?: string;
}) {
  return {
    kind: "lifecycle_tx",
    txType: input.txType,
    txHash: input.txHash,
    circleTransactionId: input.transactionId,
    refId: input.refId,
    walletId: input.walletId,
    amountUnits: input.amountUnits,
    chainId: input.chainId ?? 5042002,
    status: input.status ?? "success"
  };
}

function estimateBaseCost(agentName: string, payload: unknown, retryCount = 0): number {
  const payloadSize = JSON.stringify(payload ?? {}).length;
  const sizeUnits = Math.min(5, 1 + payloadSize / 4000);
  const retryUnits = retryCount * 0.5;
  const premium = agentName === "literature" || agentName === "repurposing" || agentName === "evidence" ? 0.5 : 0;
  return Math.round((sizeUnits + retryUnits + premium) * 100) / 100;
}

function recordAgentLedger(input: {
  db: DatabaseConnection;
  jobId: string;
  agentName: string;
  payload: unknown;
  notes?: string;
  status?: string;
  retryCount?: number;
}) {
  const baseCost = estimateBaseCost(input.agentName, input.payload, input.retryCount ?? 0);
  const contributionWeight = CONTRIBUTION_WEIGHTS[input.agentName] ?? 1;
  const riskWeight = RISK_WEIGHTS[input.agentName] ?? 1;
  const payoutWeight = Math.round((baseCost + contributionWeight + riskWeight) * 100) / 100;
  insertAgentLedgerEntry({
    db: input.db,
    entry: {
      jobId: input.jobId,
      agentName: input.agentName,
      status: input.status ?? "success",
      baseCost,
      contributionWeight,
      riskWeight,
      payoutWeight,
      notes: input.notes
    }
  });
}

async function synchronizeOnchainLifecycle(input: {
  db: DatabaseConnection;
  jobId: string;
  reportDigest: string;
  evaluator: JsonRecord;
}): Promise<"Completed" | "Rejected" | "Skipped"> {
  const { db, jobId, reportDigest, evaluator } = input;
  const onchainJob = await getErc8183Job(jobId);
  if (!onchainJob) {
    logAgentEvent({
      db,
      jobId,
      agentName: "report",
      eventType: "info",
      message: "No ERC-8183 job was found for this report id; on-chain submit/finalize skipped."
    });
    return "Skipped";
  }

  if (onchainJob.status === "Expired") {
    upsertJobRuntimeState({ db, jobId, status: "Expired", budgetUnits: BigInt(onchainJob.budget) });
    throw new Error(`erc8183_job_expired:${jobId}`);
  }

  if (onchainJob.status === "Completed" || onchainJob.status === "Rejected") {
    upsertJobRuntimeState({ db, jobId, status: onchainJob.status, budgetUnits: BigInt(onchainJob.budget) });
    logAgentEvent({
      db,
      jobId,
      agentName: "report",
      eventType: "info",
      message: `ERC-8183 job already terminal on-chain (${onchainJob.status}); no further lifecycle action was needed.`
    });
    return onchainJob.status;
  }

  const decision = String(evaluator.decision ?? "unknown").toLowerCase();
  const approved = decision === "approve" || decision === "approved";
  const finalizeReason = String(
    evaluator.reason ??
      (approved ? "approved_by_evaluator" : "rejected_by_evaluator")
  );

  if (approved && onchainJob.status === "Funded") {
    const submitResult = await submitErc8183Job(jobId, reportDigest);
    upsertJobFundingTransaction({
      db,
      jobId,
      txType: "submit",
      txHash: submitResult.txHash,
      txStatus: "success",
      chainId: 5042002,
      metadata: buildLifecycleDetails({
        txType: "submit",
        txHash: submitResult.txHash,
        transactionId: submitResult.transactionId,
        refId: submitResult.refId,
        walletId: submitResult.walletId
      })
    });
    logAgentEvent({
      db,
      jobId,
      agentName: "report",
      eventType: "payment",
      message: buildCircleLifecycleMessage({
        prefix: "Provider submit executed on ERC-8183",
        txHash: submitResult.txHash,
        transactionId: submitResult.transactionId,
        refId: submitResult.refId,
        walletId: submitResult.walletId
      }),
      details: buildLifecycleDetails({
        txType: "submit",
        txHash: submitResult.txHash,
        transactionId: submitResult.transactionId,
        refId: submitResult.refId,
        walletId: submitResult.walletId
      })
    });
    upsertJobRuntimeState({ db, jobId, status: "Submitted", budgetUnits: BigInt(onchainJob.budget) });
  }

  const refreshedJob = await getErc8183Job(jobId);
  if (!refreshedJob) {
    throw new Error(`erc8183_job_missing_after_submit:${jobId}`);
  }
  if (refreshedJob.status === "Expired") {
    upsertJobRuntimeState({ db, jobId, status: "Expired", budgetUnits: BigInt(refreshedJob.budget) });
    throw new Error(`erc8183_job_expired_after_submit:${jobId}`);
  }
  if (approved && refreshedJob.status !== "Submitted" && refreshedJob.status !== "Completed") {
    throw new Error(`erc8183_submit_not_reached:${jobId}:${refreshedJob.status}`);
  }
  if (!approved && refreshedJob.status !== "Funded" && refreshedJob.status !== "Submitted" && refreshedJob.status !== "Rejected") {
    throw new Error(`erc8183_reject_not_allowed:${jobId}:${refreshedJob.status}`);
  }

  if (refreshedJob.status !== "Completed" && refreshedJob.status !== "Rejected") {
    const finalizeResult = await finalizeErc8183Job({
      jobId,
      approved,
      reason: finalizeReason
    });
    upsertJobFundingTransaction({
      db,
      jobId,
      txType: approved ? "complete" : "reject",
      txHash: finalizeResult.txHash,
      txStatus: "success",
      chainId: 5042002,
      metadata: buildLifecycleDetails({
        txType: approved ? "complete" : "reject",
        txHash: finalizeResult.txHash,
        transactionId: finalizeResult.transactionId,
        refId: finalizeResult.refId,
        walletId: finalizeResult.walletId
      })
    });
    logAgentEvent({
      db,
      jobId,
      agentName: "pi",
      eventType: "payment",
      message: buildCircleLifecycleMessage({
        prefix: `Finalizer ${approved ? "complete" : "reject"} executed on ERC-8183`,
        txHash: finalizeResult.txHash,
        transactionId: finalizeResult.transactionId,
        refId: finalizeResult.refId,
        walletId: finalizeResult.walletId
      }),
      details: buildLifecycleDetails({
        txType: approved ? "complete" : "reject",
        txHash: finalizeResult.txHash,
        transactionId: finalizeResult.transactionId,
        refId: finalizeResult.refId,
        walletId: finalizeResult.walletId
      })
    });
  }

  const terminalJob = await getErc8183Job(jobId);
  if (!terminalJob) {
    throw new Error(`erc8183_job_missing_after_finalize:${jobId}`);
  }
  upsertJobRuntimeState({
    db,
    jobId,
    status: terminalJob.status,
    budgetUnits: BigInt(terminalJob.budget)
  });
  if (terminalJob.status !== "Completed" && terminalJob.status !== "Rejected") {
    throw new Error(`erc8183_terminal_status_missing:${jobId}:${terminalJob.status}`);
  }
  return terminalJob.status;
}

export async function runResearchPipeline(input: {
  db: DatabaseConnection;
  jobId: string;
  query: string;
  diseaseName?: string;
  rawQuery?: string;
  userType?: "pharma" | "researcher" | "doctor";
}) {
  const { db, jobId, query } = input;
  const userType = input.userType ?? "researcher";
  const diseaseName = input.diseaseName?.trim() || query;
  const rawQuery = input.rawQuery?.trim() || query;

  upsertJobRuntimeState({ db, jobId, status: "Running" });
  logAgentEvent({
    db,
    jobId,
    agentName: "pi",
    eventType: "start",
    message: "Research pipeline started by orchestrator."
  });

  logAgentEvent({
    db,
    jobId,
    agentName: "literature",
    eventType: "dispatch",
    message: "Literature agent dispatch started."
  });
  let literatureResponse;
  try {
    literatureResponse = await runLiteratureSearch({
      query: rawQuery,
      disease: diseaseName
    });
  } catch (error) {
    logAgentEvent({
      db,
      jobId,
      agentName: "literature",
      eventType: "error",
      message: buildLiteratureFailureMessage(error)
    });
    throw error;
  }
  const literature = asRecord(literatureResponse.data);
  const literatureCount = Array.isArray(literature.papers) ? literature.papers.length : 0;
  const literatureStats = asRecord(literature.retrieval_stats);
  const literatureRetrievedCount = asNumber(literatureStats.retrieved_count);
  const literatureRerankedCount = asNumber(literatureStats.preliminary_selection_count);
  const literatureProof = buildPaymentProof("literature", literatureResponse);
  logAgentEvent({
    db,
    jobId,
    agentName: "literature",
    eventType: "payment",
    message: buildPaymentEventMessage(
      "Literature",
      literatureResponse,
      `Literature nanopayment completed through Gateway for query: ${query}`
    ),
    details: literatureProof ? { kind: "x402_payment", proof: literatureProof } : null
  });
  recordAgentLedger({
    db,
    jobId,
    agentName: "literature",
    payload: literature,
    notes: `papers=${literatureCount}`
  });
  logAgentEvent({
    db,
    jobId,
    agentName: "literature",
    eventType: "result",
    message:
      literatureCount === 0
        ? literatureRetrievedCount > 0 && literatureRerankedCount > 0
          ? `Literature completed with no hit after reviewing ${literatureRetrievedCount} retrieved papers; ${literatureRerankedCount} entered reranking, but 0 cleared disease-specific reportability filters`
          : `Literature completed with no hit after reviewing ${literatureRetrievedCount} retrieved papers; 0 cleared disease-specific reportability filters`
        : literatureRerankedCount > 0 && literatureRerankedCount !== literatureCount
          ? `Literature completed: ${literatureCount} paper records cleared from ${literatureRetrievedCount} retrieved papers after ${literatureRerankedCount} entered reranking`
          : `Literature completed: ${literatureCount} paper records cleared from ${literatureRetrievedCount} retrieved papers`
  });

  logAgentEvent({
    db,
    jobId,
    agentName: "drugdb",
    eventType: "dispatch",
    message: "DrugDB agent dispatch started."
  });
  let drugdbResponse;
  try {
    drugdbResponse = await runDrugdbFetch({
      query: rawQuery,
      disease: diseaseName
    });
  } catch (error) {
    logAgentEvent({
      db,
      jobId,
      agentName: "drugdb",
      eventType: "error",
      message: buildDrugdbFailureMessage(error)
    });
    throw error;
  }
  const drugdb = asRecord(drugdbResponse.data);
  const targetCount = Array.isArray(drugdb.chembl_targets) ? drugdb.chembl_targets.length : 0;
  const moleculeCount = Array.isArray(drugdb.activity_molecule_ids) ? drugdb.activity_molecule_ids.length : 0;
  const drugdbStats = asRecord(drugdb.retrieval_stats);
  const chemblStatus = asString(drugdbStats.chembl_status);
  const chemblDegradedReason = asString(drugdbStats.chembl_degraded_reason);
  const openTargetsDrugCount = asNumber(drugdbStats.opentargets_drug_count);
  const expandedCandidateCount = asNumber(drugdbStats.expanded_candidate_count);
  const drugdbProof = buildPaymentProof("drugdb", drugdbResponse);
  logAgentEvent({
    db,
    jobId,
    agentName: "drugdb",
    eventType: "payment",
    message: buildPaymentEventMessage(
      "DrugDB",
      drugdbResponse,
      `DrugDB nanopayment completed through Gateway for query: ${query}`
    ),
    details: drugdbProof ? { kind: "x402_payment", proof: drugdbProof } : null
  });
  recordAgentLedger({
    db,
    jobId,
    agentName: "drugdb",
    payload: drugdb,
    notes:
      `targets=${targetCount}; ` +
      `molecules=${moleculeCount}`
  });
  logAgentEvent({
    db,
    jobId,
    agentName: "drugdb",
    eventType: "result",
    message:
      chemblStatus === "degraded"
        ? targetCount === 0 && moleculeCount === 0
          ? `DrugDB completed with degraded ChEMBL lookup: ${openTargetsDrugCount} Open Targets drug rows and ${expandedCandidateCount} expanded candidates were recovered without ChEMBL target matches`
          : `DrugDB completed with degraded ChEMBL lookup: ${targetCount} ChEMBL targets, ${openTargetsDrugCount} Open Targets drug rows, ${moleculeCount} activity molecule ids, and ${expandedCandidateCount} expanded candidates (${chemblDegradedReason || "ChEMBL target lookup was partially unavailable"})`
        : targetCount === 0 && moleculeCount === 0
          ? "DrugDB completed with no hit for this query"
        : `DrugDB completed: ${targetCount} ChEMBL targets, ${openTargetsDrugCount} Open Targets drug rows, ${moleculeCount} activity molecule ids, and ${expandedCandidateCount} expanded candidates`
  });

  logAgentEvent({
    db,
    jobId,
    agentName: "pathway",
    eventType: "dispatch",
    message: "Pathway agent dispatch started."
  });
  let pathwayResponse;
  try {
    pathwayResponse = await runPathwayAnalysisPaid({
      query: rawQuery,
      disease_name: diseaseName
    });
  } catch (error) {
    logAgentEvent({
      db,
      jobId,
      agentName: "pathway",
      eventType: "error",
      message: "Pathway failed before returning a result"
    });
    throw error;
  }
  const pathway = asRecord(pathwayResponse.data);
  const pathwayCount = Array.isArray(pathway.pathways) ? pathway.pathways.length : 0;
  const trialCount = Array.isArray(pathway.clinical_trials) ? pathway.clinical_trials.length : 0;
  const geneticCount = Array.isArray(pathway.genetic_evidence) ? pathway.genetic_evidence.length : 0;
  const pathwayProof = buildPaymentProof("pathway", pathwayResponse);
  logAgentEvent({
    db,
    jobId,
    agentName: "pathway",
    eventType: "payment",
    message: buildPaymentEventMessage(
      "Pathway",
      pathwayResponse,
      `Pathway nanopayment completed through Gateway for query: ${query}`
    ),
    details: pathwayProof ? { kind: "x402_payment", proof: pathwayProof } : null
  });
  recordAgentLedger({
    db,
    jobId,
    agentName: "pathway",
    payload: pathway,
    notes:
      `pathways=${pathwayCount}; ` +
      `trials=${trialCount}; ` +
      `genetics=${geneticCount}`
  });
  logAgentEvent({
    db,
    jobId,
    agentName: "pathway",
    eventType: "result",
    message:
      pathwayCount === 0 && trialCount === 0 && geneticCount === 0
        ? "Pathway completed with no hit for this query"
        : `Pathway completed: ${pathwayCount} pathways, ${trialCount} active trials, ${geneticCount} genetic evidence blocks`
  });

  logAgentEvent({
    db,
    jobId,
    agentName: "repurposing",
    eventType: "dispatch",
    message: "Repurposing agent dispatch started."
  });
  const repurposing = asRecord(
    await runRepurposingAnalysis({
      query,
      literature,
      drugdb,
      pathway
    })
  );
  recordAgentLedger({
    db,
    jobId,
    agentName: "repurposing",
    payload: repurposing,
    notes: (() => {
      const repurposingDebug = asRecord(repurposing.debug);
      const filteredCount = Array.isArray(repurposingDebug.filtered_candidates) ? repurposingDebug.filtered_candidates.length : 0;
      return (
      `hypotheses=${Array.isArray(repurposing.hypotheses) ? repurposing.hypotheses.length : 0}; ` +
      `salvage_applied=${repurposingDebug.salvage_applied === true ? 1 : 0}; ` +
      `filtered=${filteredCount}`
      );
    })()
  });
  logAgentEvent({
    db,
    jobId,
    agentName: "repurposing",
    eventType: "result",
    message:
      (Array.isArray(repurposing.hypotheses) ? repurposing.hypotheses.length : 0) > 0
        ? `Repurposing returned ${Array.isArray(repurposing.hypotheses) ? repurposing.hypotheses.length : 0} hypotheses`
        : "Repurposing did not produce shortlist hypotheses in this pass"
  });
  const repurposingDebug = asRecord(repurposing.debug);
  if (repurposingDebug.salvage_applied === true) {
    logAgentEvent({
      db,
      jobId,
      agentName: "repurposing",
      eventType: "debug",
      message:
        "Repurposing single-candidate salvage applied: the only expanded candidate was retained as a low-confidence mechanism-first hypothesis."
    });
  }
  const filteredCandidates = Array.isArray(repurposingDebug.filtered_candidates)
    ? repurposingDebug.filtered_candidates.slice(0, 3).map((item) => asRecord(item))
    : [];
  const repurposingFilterSummary = Array.isArray(repurposingDebug.filter_summary)
    ? repurposingDebug.filter_summary.map((item) => asRecord(item))
    : [];
  if (filteredCandidates.length > 0) {
    const firstUserMessage =
      asString(repurposingFilterSummary[0]?.user_message) || asString(filteredCandidates[0]?.user_message);
    const dominantFilterCount = Number(asString(repurposingFilterSummary[0]?.count) || "0") || 0;
    const totalFilteredCount = Array.isArray(repurposingDebug.filtered_candidates)
      ? repurposingDebug.filtered_candidates.length
      : filteredCandidates.length;

    logAgentEvent({
      db,
      jobId,
      agentName: "repurposing",
      eventType: "debug",
      message:
        `Repurposing reviewed ${totalFilteredCount} additional ` +
        `candidate${totalFilteredCount === 1 ? "" : "s"}, but they were not promoted into the shortlist.` +
        (firstUserMessage
          ? dominantFilterCount > 0
            ? ` In ${dominantFilterCount} case${dominantFilterCount === 1 ? "" : "s"}, ${firstUserMessage.charAt(0).toLowerCase()}${firstUserMessage.slice(1)}`
            : ` ${firstUserMessage}`
          : "")
    });
  }

  logAgentEvent({
    db,
    jobId,
    agentName: "evidence",
    eventType: "dispatch",
    message: "Evidence scorer dispatch started."
  });
  const evidence = asRecord(
    await runEvidenceScoring({
      query,
      literature,
      pathway,
      repurposing
    })
  );
  recordAgentLedger({
    db,
    jobId,
    agentName: "evidence",
    payload: evidence,
    notes: `scores=${Array.isArray(evidence.scores) ? evidence.scores.length : 0}`
  });
  logAgentEvent({
    db,
    jobId,
    agentName: "evidence",
    eventType: "result",
    message:
      (Array.isArray(evidence.scores) ? evidence.scores.length : 0) > 0
        ? `Evidence scorer returned ${Array.isArray(evidence.scores) ? evidence.scores.length : 0} scores`
        : "Evidence scoring did not continue because no shortlist advanced from candidate review"
  });

  logAgentEvent({
    db,
    jobId,
    agentName: "red_team",
    eventType: "dispatch",
    message: "Red-team critic dispatch started."
  });
  let redTeamResponse;
  try {
    redTeamResponse = await runRedTeamReview({
      query,
      literature,
      pathway,
      repurposing,
      evidence
    });
  } catch (error) {
    logAgentEvent({
      db,
      jobId,
      agentName: "red_team",
      eventType: "error",
      message: "Red-team failed before returning a result"
    });
    throw error;
  }
  const redTeam = asRecord(redTeamResponse.data);
  const critiqueCount = Array.isArray(redTeam.critiques) ? redTeam.critiques.length : 0;
  const redTeamProof = buildPaymentProof("critics", redTeamResponse);
  logAgentEvent({
    db,
    jobId,
    agentName: "red_team",
    eventType: "payment",
    message: buildPaymentEventMessage(
      "Critics",
      redTeamResponse,
      `Critics nanopayment completed through Gateway for report ${jobId}`
    ),
    details: redTeamProof ? { kind: "x402_payment", proof: redTeamProof } : null
  });
  recordAgentLedger({
    db,
    jobId,
    agentName: "red_team",
    payload: redTeam,
    notes: `critiques=${critiqueCount}`
  });
  logAgentEvent({
    db,
    jobId,
    agentName: "red_team",
    eventType: "result",
    message:
      critiqueCount === 0
        ? "Red-team completed with no critiques for this report"
        : `Red-team completed: ${critiqueCount} critiques`
  });

  logAgentEvent({
    db,
    jobId,
    agentName: "report",
    eventType: "dispatch",
    message: "Report agent dispatch started."
  });

  let draftReport = buildReportPayload({
    jobId,
    query,
    literature,
    drugdb,
    pathway,
    repurposing,
    evidence,
    redTeam,
    evaluator: {},
    userType,
    paymentProofs: [
      literatureProof,
      drugdbProof,
      pathwayProof,
      redTeamProof
    ].filter(Boolean) as Array<{
      agent: string;
      endpoint?: string;
      seller?: string;
      payer?: string;
      network?: string;
      transaction?: string;
      settled?: boolean;
    }>
  });
  draftReport = (await enhanceReportNarrative(draftReport)).payload;
  assertReportSafety("draft", jobId, draftReport);

  logAgentEvent({
    db,
    jobId,
    agentName: "report",
    eventType: "complete",
    message: "Report assembly completed and delivered to PI."
  });
  logAgentEvent({
    db,
    jobId,
    agentName: "pi",
    eventType: "dispatch",
    message: "Review service dispatch started."
  });
  let evaluatorResponse;
  try {
    evaluatorResponse = await runEvaluatorReview({
      reportId: jobId,
      job_id: jobId,
      report: asRecord(draftReport.report),
      evidence_scores: draftReport.evidence_scores as unknown as Array<Record<string, unknown>>
    });
  } catch (error) {
    logAgentEvent({
      db,
      jobId,
      agentName: "pi",
      eventType: "error",
      message: "Review service failed before returning a result"
    });
    throw error;
  }
  const evaluator = asRecord(evaluatorResponse.data);
  const evaluatorProof = buildPaymentProof("review", evaluatorResponse);
  logAgentEvent({
    db,
    jobId,
    agentName: "pi",
    eventType: "payment",
    message: buildPaymentEventMessage(
      "Review",
      evaluatorResponse,
      `Review nanopayment completed through Gateway for report ${jobId}`
    ),
    details: evaluatorProof ? { kind: "x402_payment", proof: evaluatorProof } : null
  });
  logAgentEvent({
    db,
    jobId,
    agentName: "pi",
    eventType: "result",
    message: `Review decision=${String(evaluator.decision ?? "unknown")}${evaluator.reason ? ` reason=${String(evaluator.reason)}` : ""}`
  });

  let finalReport = buildReportPayload({
    jobId,
    query,
    literature,
    drugdb,
    pathway,
    repurposing,
    evidence,
    redTeam,
    evaluator,
    userType,
    paymentProofs: [
      literatureProof,
      drugdbProof,
      pathwayProof,
      redTeamProof,
      evaluatorProof
    ].filter(Boolean) as Array<{
      agent: string;
      endpoint?: string;
      seller?: string;
      payer?: string;
      network?: string;
      transaction?: string;
      settled?: boolean;
    }>
  });
  const narrativeResult = await enhanceReportNarrative(finalReport);
  finalReport = narrativeResult.payload;
  assertReportSafety("final", jobId, finalReport);
  logAgentEvent({
    db,
    jobId,
    agentName: "report",
    eventType: "result",
    message:
      narrativeResult.synthesisMode === "llm"
        ? `Report narrative synthesized with ${finalReport.report.provenance.models_used.report}`
        : "Report narrative synthesized with deterministic fallback"
  });
  recordAgentLedger({
    db,
    jobId,
    agentName: "report",
    payload: finalReport,
    notes:
      `top_candidates=${Array.isArray(asRecord(finalReport.report).top_candidates) ? (asRecord(finalReport.report).top_candidates as unknown[]).length : 0}; ` +
      `evidence_scores=${Array.isArray(finalReport.evidence_scores) ? finalReport.evidence_scores.length : 0}`
  });

  saveStoredReport(jobId, finalReport as unknown as StoredReportPayload);
  const terminalLifecycleStatus = await synchronizeOnchainLifecycle({
    db,
    jobId,
    reportDigest: String(finalReport.ipfs_hash ?? ""),
    evaluator
  });
  if (terminalLifecycleStatus === "Completed") {
    upsertJobRuntimeState({ db, jobId, status: "DistributingPayouts" });
    const payoutResult = await distributeInternalPayouts({ db, jobId });
    if (payoutResult.status === "success") {
      logAgentEvent({
        db,
        jobId,
        agentName: "pi",
        eventType: "complete",
        message: `Internal payouts completed for ${payoutResult.records.length} recipients.`
      });
    } else if (payoutResult.status === "partial_failure") {
      logAgentEvent({
        db,
        jobId,
        agentName: "pi",
        eventType: "error",
        message: `Internal payouts partially failed for ${payoutResult.failures?.length ?? 0} recipients.`
      });
    } else {
      logAgentEvent({
        db,
        jobId,
        agentName: "pi",
        eventType: "info",
        message: `Internal payouts skipped: ${payoutResult.reason ?? "no payout plan"}`
      });
    }
  } else if (terminalLifecycleStatus === "Rejected") {
    logAgentEvent({
      db,
      jobId,
      agentName: "pi",
      eventType: "info",
      message: "Internal payouts skipped because peer review rejected the report and escrow was refunded."
    });
  }
  logAgentEvent({
    db,
    jobId,
    agentName: "report",
    eventType: "complete",
    message: "Report synthesized and written to reports directory."
  });
  upsertJobRuntimeState({ db, jobId, status: "Completed" });

  return finalReport;
}
