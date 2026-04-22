import {
  buildSellerChallenge,
  createSellerCatalog,
  verifySellerPaymentLive
} from "@biomed/gateway-seller";
import { resolveWalletRegistry } from "@biomed/payments";
import {
  runPathwayAnalysis,
  runRedTeamAnalysis
} from "@biomed/agents";
import {
  runDrugdbFetchService,
  runEvaluatorReviewService,
  runLiteratureSearchService
} from "./resource-services.js";

export interface PaidEndpointResolution {
  key: "literature-search" | "drugdb-fetch" | "pathway-analysis" | "review" | "red-team-critics";
  path: string;
  payTo: string;
}

function findSellerAddress(key: "literature" | "drugdb" | "pathway" | "reviewSeller" | "redTeamSeller"): string {
  const registry = resolveWalletRegistry();
  const entry = registry.find((item) => item.key === key);
  const fallbackMap: Record<typeof key, string | undefined> = {
    literature: process.env.LITERATURE_AGENT_WALLET_ADDRESS?.trim() || process.env.LITERATURE_AGENT_ADDRESS?.trim(),
    drugdb: process.env.DRUGDB_AGENT_WALLET_ADDRESS?.trim() || process.env.DRUGDB_AGENT_ADDRESS?.trim(),
    pathway: process.env.PATHWAY_AGENT_WALLET_ADDRESS?.trim() || process.env.PATHWAY_AGENT_ADDRESS?.trim(),
    reviewSeller:
      process.env.REVIEW_PAYMENT_ADDRESS?.trim() ||
      process.env.REVIEW_SELLER_ADDRESS?.trim(),
    redTeamSeller:
      process.env.RED_TEAM_PAYMENT_ADDRESS?.trim() ||
      process.env.RED_TEAM_SELLER_ADDRESS?.trim() ||
      process.env.RED_TEAM_AGENT_WALLET_ADDRESS?.trim() ||
      process.env.RED_TEAM_AGENT_ADDRESS?.trim()
  };
  const fallback = fallbackMap[key];
  const resolved = entry?.address?.trim() || fallback || "";
  if (!resolved) {
    throw new Error(
      key === "literature"
        ? "LITERATURE_AGENT_WALLET_ADDRESS or LITERATURE_AGENT_ADDRESS must be configured for the literature paid service."
        : key === "drugdb"
          ? "DRUGDB_AGENT_WALLET_ADDRESS or DRUGDB_AGENT_ADDRESS must be configured for the DrugDB paid service."
          : key === "pathway"
            ? "PATHWAY_AGENT_WALLET_ADDRESS or PATHWAY_AGENT_ADDRESS must be configured for the pathway paid service."
            : key === "reviewSeller"
              ? "REVIEW_PAYMENT_ADDRESS or REVIEW_SELLER_ADDRESS must be configured for paid review challenges."
              : "RED_TEAM_PAYMENT_ADDRESS, RED_TEAM_SELLER_ADDRESS, or RED_TEAM_AGENT_ADDRESS must be configured for paid critics challenges."
    );
  }
  return resolved;
}

export function getPaidEndpoints(): PaidEndpointResolution[] {
  const catalog = createSellerCatalog();
  return catalog.endpoints.map((endpoint) => ({
    key: endpoint.key,
    path: endpoint.path,
    payTo: (() => {
      if (endpoint.service === "literature") return findSellerAddress("literature");
      if (endpoint.service === "drugdb") return findSellerAddress("drugdb");
      if (endpoint.service === "pathway") return findSellerAddress("pathway");
      if (endpoint.service === "evaluator") return findSellerAddress("reviewSeller");
      if (endpoint.service === "red_team") return findSellerAddress("redTeamSeller");
      return findSellerAddress("reviewSeller");
    })()
  }));
}

export function resolvePaidEndpoint(pathname: string): PaidEndpointResolution | null {
  return getPaidEndpoints().find((endpoint) => pathname === `/api/paid${endpoint.path}`) ?? null;
}

async function buildPaidPayload(input: {
  endpoint: PaidEndpointResolution["key"];
  payload: unknown;
}) {
  const payload = (input.payload as Record<string, unknown> | null) ?? {};
  const diseaseName =
    typeof payload.disease_name === "string"
      ? payload.disease_name
      : typeof payload.disease === "string"
        ? payload.disease
        : undefined;

  if (input.endpoint === "literature-search") {
    return runLiteratureSearchService({
      query: String(payload.query ?? diseaseName ?? ""),
      disease_name: diseaseName
    });
  }

  if (input.endpoint === "drugdb-fetch") {
    return runDrugdbFetchService({
      query: typeof payload.query === "string" ? payload.query : undefined,
      disease_name: diseaseName,
      max_candidates:
        typeof payload.max_candidates === "number" ? payload.max_candidates : undefined
    });
  }

  if (input.endpoint === "pathway-analysis") {
    return runPathwayAnalysis({
      query: typeof payload.query === "string" ? payload.query : "",
      disease_name: diseaseName
    });
  }

  if (input.endpoint === "red-team-critics") {
    return runRedTeamAnalysis({
      query: typeof payload.query === "string" ? payload.query : "",
      literature: typeof payload.literature === "object" && payload.literature ? (payload.literature as Record<string, unknown>) : {},
      pathway: typeof payload.pathway === "object" && payload.pathway ? (payload.pathway as Record<string, unknown>) : {},
      repurposing:
        typeof payload.repurposing === "object" && payload.repurposing
          ? (payload.repurposing as Record<string, unknown>)
          : {},
      evidence: typeof payload.evidence === "object" && payload.evidence ? (payload.evidence as Record<string, unknown>) : {}
    });
  }

  return runEvaluatorReviewService({
    job_id: typeof payload.job_id === "string" ? payload.job_id : undefined,
    reportId: typeof payload.reportId === "string" ? payload.reportId : undefined,
    report: typeof payload.report === "object" && payload.report ? (payload.report as Record<string, unknown>) : undefined,
    evidence_scores: Array.isArray(payload.evidence_scores)
      ? (payload.evidence_scores as Array<Record<string, unknown>>)
      : undefined
  });
}

export async function createPaidResourceResponse(input: {
  pathname: string;
  paymentHeader: string | null;
  payload: unknown;
}): Promise<Response | null> {
  const endpoint = resolvePaidEndpoint(input.pathname);
  if (!endpoint) return null;

  if (!input.paymentHeader) {
    const challenge = buildSellerChallenge({
      chainId: 5042002,
      payTo: endpoint.payTo
    });

    return new Response(JSON.stringify(challenge.body), {
      status: challenge.statusCode,
      headers: {
        "content-type": "application/json",
        ...challenge.headers
      }
    });
  }

  const verification = await verifySellerPaymentLive({
    paymentHeader: input.paymentHeader,
    sellerAddress: endpoint.payTo
  });

  if (!verification.ok) {
    return new Response(
      JSON.stringify({
        error: "payment_invalid",
        detail: verification.detail ?? "payment verification failed"
      }),
      {
        status: 402,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }

  let servicePayload: Record<string, unknown>;
  try {
    servicePayload = (await buildPaidPayload({
      endpoint: endpoint.key,
      payload: input.payload
    })) as Record<string, unknown>;
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "service_execution_failed",
        detail: error instanceof Error ? error.message : "paid service failed"
      }),
      {
        status: 502,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }

  return new Response(
    JSON.stringify({
      ...servicePayload,
      endpoint: endpoint.key,
      servicePath: endpoint.path,
      seller: endpoint.payTo,
      verification
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "payment-response": JSON.stringify({
          settled: true,
          mode: "circle-gateway",
          endpoint: endpoint.key,
          transaction: verification.transaction,
          payer: verification.payer,
          network: verification.network
        })
      }
    }
  );
}
