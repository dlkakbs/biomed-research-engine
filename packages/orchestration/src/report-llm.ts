import { callOpenRouterJson, isOpenRouterConfigured } from "@biomed/agents";
import type { ReportPayload } from "./report-heuristics.js";

type CandidatePatch = {
  drug_name: string;
  why_candidate?: string;
  main_risk?: string;
  testable_prediction?: string;
  score_rationale?: string;
  false_positive_risk?: string;
};

function sentence(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function hasRubricPhrase(text: string): boolean {
  return /100[\s-]*point(?:\s+\w+){0,3}\s+rubric/i.test(text);
}

function hasLimitationsPhrase(text: string): boolean {
  return /\bkey\s+limitations\s*:|\blimitations\s*:/i.test(text);
}

function extractSentence(text: string, pattern: RegExp): string | null {
  const normalized = sentence(text);
  const match = normalized.match(new RegExp(`[^.]*${pattern.source}[^.]*\\.?`, pattern.flags));
  return match?.[0]?.trim() || null;
}

function enforceMethodologyGuardrails(rewritten: string, fallback: string): string {
  let result = sentence(rewritten || fallback);
  const normalizedFallback = sentence(fallback);

  result = result
    .replace(/Key limitations:\s*$/i, "")
    .replace(/(?:The ranking uses a fixed 100-point rubric[^.]*\.\s*){2,}/i, (match) => {
      const sentenceMatch = match.match(/The ranking uses a fixed 100-point rubric[^.]*\./i);
      return sentenceMatch?.[0] ? `${sentenceMatch[0]} ` : match;
    })
    .trim();

  if (!hasRubricPhrase(result) && hasRubricPhrase(normalizedFallback)) {
    const rubricSentence =
      extractSentence(normalizedFallback, /100[\s-]*point(?:\s+\w+){0,3}\s+rubric/i) ??
      "The ranking uses a fixed 100-point rubric for literature support, mechanism overlap, clinical evidence, safety profile, and genetic support.";
    result = sentence(`${result} ${rubricSentence}`);
  }

  if (!hasLimitationsPhrase(result) && hasLimitationsPhrase(normalizedFallback)) {
    const limitationsSentence =
      extractSentence(normalizedFallback, /\bkey\s+limitations\s*:|\blimitations\s*:/i) ??
      "Key limitations: the outputs remain prioritization-grade rather than causal proof, and the report does not claim target validation or treatment efficacy.";
    result = sentence(`${result} ${limitationsSentence}`);
  }

  return result.replace(/Key limitations:\s*$/i, "").trim();
}

export async function enhanceReportNarrative(
  payload: ReportPayload
): Promise<{ payload: ReportPayload; modelUsed?: string; synthesisMode: "llm" | "deterministic" }> {
  if (!isOpenRouterConfigured()) {
    return { payload, synthesisMode: "deterministic" };
  }

  try {
    const originalSummary = sentence(payload.report.summary);
    const originalMethodology = sentence(payload.report.methodology);
    const evaluatorDecision = sentence(String(payload.report.evaluator_summary?.decision ?? "unknown")).toLowerCase();
    const isPreEvaluatorPass = !evaluatorDecision || evaluatorDecision === "unknown";
    const completion = await callOpenRouterJson<{
      summary?: string;
      methodology?: string;
      top_candidates?: CandidatePatch[];
    }>({
        model: "google/gemini-2.5-flash",
      system:
        "You are a biomedical report synthesizer. Return only strict JSON. " +
        "Rewrite the report summary and methodology to sound like a serious research marketplace output. " +
        "Prefer concise, readable language over exhaustive detail. " +
        "Avoid repeating the same claim in multiple ways. " +
        "Keep all caveats, non-medical framing, and uncertainty. " +
        "Do not change rankings, scores, PMIDs, or structured provenance. " +
        "For candidate patches, improve wording only; do not add new factual claims. " +
        "Keep summary under 4 sentences when possible, and keep each candidate patch field to 1-2 sentences.",
      user:
        `Disclaimer: ${payload.report.disclaimer}\n` +
        `Current summary: ${payload.report.summary}\n` +
        `Current methodology: ${payload.report.methodology}\n` +
        `Evaluator summary: ${JSON.stringify(payload.report.evaluator_summary)}\n` +
        `Top candidates: ${JSON.stringify(payload.report.top_candidates.slice(0, 5))}\n` +
        'Return JSON with keys "summary", "methodology", and "top_candidates". ' +
        "Each top_candidates item should contain drug_name and any rewritten narrative fields among why_candidate, main_risk, testable_prediction, score_rationale, false_positive_risk."
    });

    const parsed = completion.data ?? {};
    const candidatePatchMap = new Map(
      (Array.isArray(parsed.top_candidates) ? parsed.top_candidates : [])
        .map((item) => [String(item.drug_name ?? "").toUpperCase(), item] as const)
        .filter(([name]) => Boolean(name))
    );

    payload.report.summary = payload.report.no_hit
      ? originalSummary
      : sentence(String(parsed.summary ?? payload.report.summary));
    payload.report.methodology = isPreEvaluatorPass
      ? originalMethodology
      : enforceMethodologyGuardrails(String(parsed.methodology ?? originalMethodology), originalMethodology);
    payload.report.top_candidates = payload.report.top_candidates.map((candidate) => {
      const patch = candidatePatchMap.get(candidate.drug_name.toUpperCase());
      if (!patch) return candidate;
      return {
        ...candidate,
        why_candidate: sentence(String(patch.why_candidate ?? candidate.why_candidate)),
        main_risk: sentence(String(patch.main_risk ?? candidate.main_risk)),
        testable_prediction: sentence(String(patch.testable_prediction ?? candidate.testable_prediction)),
        score_rationale: sentence(String(patch.score_rationale ?? candidate.score_rationale)),
        false_positive_risk: sentence(String(patch.false_positive_risk ?? candidate.false_positive_risk))
      };
    });
    payload.report.novel_candidates = payload.report.top_candidates.filter((candidate) => candidate.novelty_class === "novel");
    payload.report.provenance.models_used.report = completion.model;
    payload.provenance.models_used.report = completion.model;

    return {
      payload,
      modelUsed: completion.model,
      synthesisMode: "llm"
    };
  } catch {
    return { payload, synthesisMode: "deterministic" };
  }
}
