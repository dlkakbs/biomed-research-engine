import { CircleWalletClient, requestPaidService } from "@biomed/payments";

const DEFAULT_API_URL = process.env.API_URL || "http://localhost:3001";

export interface LiteratureSearchRequest {
  query: string;
  disease?: string;
}

export interface DrugdbFetchRequest {
  query: string;
  disease?: string;
}

export interface EvaluatorReviewRequest {
  reportId: string;
  job_id?: string;
  report?: Record<string, unknown>;
  evidence_scores?: Array<Record<string, unknown>>;
  verdict?: "approve" | "reject";
}

export interface PathwayAnalysisRequest {
  query: string;
  disease_name?: string;
}

export interface RedTeamReviewRequest {
  query: string;
  literature: Record<string, unknown>;
  pathway: Record<string, unknown>;
  repurposing: Record<string, unknown>;
  evidence: Record<string, unknown>;
}

function getCircleWalletClient() {
  return CircleWalletClient.fromEnv();
}

export async function runLiteratureSearch(input: LiteratureSearchRequest) {
  return requestPaidService<LiteratureSearchRequest, Record<string, unknown>>({
    baseUrl: DEFAULT_API_URL,
    endpoint: "/api/paid/literature/search",
    payload: input,
    buyerKey: "pi",
    circle: getCircleWalletClient()
  });
}

export async function runDrugdbFetch(input: DrugdbFetchRequest) {
  return requestPaidService<DrugdbFetchRequest, Record<string, unknown>>({
    baseUrl: DEFAULT_API_URL,
    endpoint: "/api/paid/drugdb/fetch",
    payload: input,
    buyerKey: "pi",
    circle: getCircleWalletClient()
  });
}

export async function runEvaluatorReview(input: EvaluatorReviewRequest) {
  return requestPaidService<EvaluatorReviewRequest, Record<string, unknown>>({
    baseUrl: DEFAULT_API_URL,
    endpoint: "/api/paid/review",
    payload: input,
    buyerKey: "pi",
    circle: getCircleWalletClient()
  });
}

export async function runPathwayAnalysisPaid(input: PathwayAnalysisRequest) {
  return requestPaidService<PathwayAnalysisRequest, Record<string, unknown>>({
    baseUrl: DEFAULT_API_URL,
    endpoint: "/api/paid/pathway/analyze",
    payload: input,
    buyerKey: "pi",
    circle: getCircleWalletClient()
  });
}

export async function runRedTeamReview(input: RedTeamReviewRequest) {
  return requestPaidService<RedTeamReviewRequest, Record<string, unknown>>({
    baseUrl: DEFAULT_API_URL,
    endpoint: "/api/paid/red-team/review",
    payload: input,
    buyerKey: "pi",
    circle: getCircleWalletClient()
  });
}
