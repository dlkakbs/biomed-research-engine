import { callOpenRouterJson, isOpenRouterConfigured } from "./openrouter.js";

type JsonRecord = Record<string, unknown>;

interface RedTeamCritique {
  drug_name: string;
  translation_risk: string;
  evidence_confounders: string;
  disease_specific_failure: string;
  failure_mode: string;
  disconfirming_signal: string;
  critical_test: string;
  severity: "low" | "medium" | "high";
  evidence_basis: "direct" | "indirect" | "speculative";
  summary: string;
}

export interface RedTeamAnalysisResult {
  agent: "red_team";
  status: "success";
  critiques: RedTeamCritique[];
  model_used?: string;
  synthesis_mode?: "llm" | "deterministic";
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
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

function sentence(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function paperEvidenceSnippets(paper: JsonRecord): string[] {
  return asArray<string>(paper.evidence_snippets).map(asString).filter(Boolean);
}

function paperHasTargetedSourceVerification(paper: JsonRecord): boolean {
  return asString(paper.content_level) === "full_text" && paperEvidenceSnippets(paper).length > 0;
}

function buildTranslationRisk(hypothesis: JsonRecord, score: JsonRecord): string {
  const confidence = asString(hypothesis.confidence);
  const clinicalEvidence = asNumber(asRecord(score.breakdown).clinical_evidence);
  if (confidence === "low" || clinicalEvidence <= 8) {
    return "Clinical translation risk is high because the current signal is still dominated by mechanism and sparse disease-specific human evidence.";
  }
  if (clinicalEvidence <= 14) {
    return "Clinical translation risk remains moderate because adjacent clinical exposure does not guarantee benefit in this disease context.";
  }
  return "Even with some clinical support, translation risk remains because indication transfer can fail despite apparently coherent biology.";
}

function buildEvidenceConfounders(input: {
  papers: JsonRecord[];
}): string {
  const paperCount = input.papers.length;
  const preclinicalCount = input.papers.filter((paper) => asString(paper.clinical_maturity) === "low").length;
  const flaggedCount = input.papers.filter((paper) => ["high", "medium"].includes(asString(paper.risk_level))).length;
  const verifiedPaperCount = input.papers.filter(paperHasTargetedSourceVerification).length;
  if (paperCount === 0) {
    return "Evidence quality is weak because no PMID-linked disease papers were available for direct inspection in this run.";
  }
  if (preclinicalCount === paperCount) {
    return verifiedPaperCount > 0
      ? "The supporting literature remained entirely preclinical even after targeted source checks, so publication bias and model-to-human translation failure remain major confounders."
      : "The supporting literature is entirely preclinical, so publication bias and model-to-human translation failure remain major confounders.";
  }
  if (flaggedCount > 0) {
    return `At least ${flaggedCount} supporting paper(s) carried quality or risk flags, so selective reporting and study-design confounding remain plausible.`;
  }
  if (paperCount <= 2) {
    return verifiedPaperCount > 0
      ? "The supporting literature base is still thin despite targeted source checks, which increases the chance that the observed signal is unstable or driven by isolated positive studies."
      : "The supporting literature base is thin, which increases the chance that the observed signal is unstable or driven by isolated positive studies.";
  }
  return verifiedPaperCount > 0
    ? "The literature base is usable and includes targeted source checks, but publication bias, endpoint mismatch, and indication-adjacent overinterpretation still remain plausible."
    : "The literature base is usable but still vulnerable to publication bias, endpoint mismatch, and indication-adjacent overinterpretation.";
}

function buildDiseaseSpecificFailure(input: {
  drugName: string;
  hypothesis: JsonRecord;
  pathway: JsonRecord;
}): string {
  const gene = asArray<string>(asRecord(asArray<JsonRecord>(input.pathway.genetic_evidence)[0]).prioritized_genes)[0];
  const mechanismOverlap = asString(input.hypothesis.mechanism_overlap).toLowerCase();
  const currentUse = asString(input.hypothesis.current_use);
  const knownDiseaseAsset = input.hypothesis.known_disease_asset === true;

  if (knownDiseaseAsset) {
    return `${input.drugName} may fail as a repurposing lead because the signal could reflect known disease-adjacent activity rather than a distinct cross-indication mechanism.`;
  }
  if (currentUse) {
    return `${input.drugName} may fail if its existing indication history does not transfer into the ${mechanismOverlap || "current disease"} setting with the required dosing window, exposure, or tissue context.`;
  }
  if (gene) {
    return `${input.drugName} may fail if the apparent pathway overlap around ${gene} is upstream of the actual disease bottleneck and does not translate into a meaningful phenotype change.`;
  }
  return `${input.drugName} may fail if the mechanism signal is real but not disease-central enough to produce clinically meaningful benefit.`;
}

function buildDisconfirmingSignal(input: {
  drugName: string;
  papers: JsonRecord[];
  pathway: JsonRecord;
}): string {
  const firstGene = asArray<string>(asRecord(asArray<JsonRecord>(input.pathway.genetic_evidence)[0]).prioritized_genes)[0];
  const humanMaturity = input.papers.filter((paper) => ["high", "medium"].includes(asString(paper.clinical_maturity))).length;
  if (firstGene) {
    return `Confidence should drop if ${input.drugName} fails to move biomarkers tied to ${firstGene} or the linked disease-biology pathway in follow-up work.`;
  }
  if (humanMaturity > 0) {
    return `Confidence should drop if the disease-adjacent human evidence does not reproduce in disease-specific cohorts or biomarker-defined subgroups.`;
  }
  return `Confidence should drop if preclinical signals fail to reproduce in stronger disease models or human data.`;
}

function buildCriticalTest(input: {
  drugName: string;
  pathway: JsonRecord;
}): string {
  const firstGene = asArray<string>(asRecord(asArray<JsonRecord>(input.pathway.genetic_evidence)[0]).prioritized_genes)[0];
  if (firstGene) {
    return `Test whether ${input.drugName} changes biomarkers or readouts linked to ${firstGene} in the subgroup most aligned with the proposed mechanism.`;
  }
  return `Test whether ${input.drugName} shifts the key disease biomarkers or phenotype readouts expected from the proposed mechanism.`;
}

function deriveSeverity(input: {
  hypothesis: JsonRecord;
  score: JsonRecord;
  papers: JsonRecord[];
  pathway: JsonRecord;
}): "low" | "medium" | "high" {
  const clinicalEvidence = asNumber(asRecord(input.score.breakdown).clinical_evidence);
  const highRiskPapers = input.papers.filter((paper) => asString(paper.risk_level) === "high").length;
  const mechanismText = `${asString(input.hypothesis.mechanism_hypothesis)} ${asString(input.hypothesis.mechanism_overlap)}`.toLowerCase();
  const currentUse = asString(input.hypothesis.current_use).toLowerCase();
  const firstGene = asArray<string>(asRecord(asArray<JsonRecord>(input.pathway.genetic_evidence)[0]).prioritized_genes)[0]?.toLowerCase() ?? "";

  const contradictionSignals = [
    "paradox",
    "opposite",
    "inhibiting telomerase in a telomere-deficient disease",
    "directional mismatch",
    "loss-of-function"
  ];
  const safetyCollapseSignals = [
    "toxicity",
    "acute exacerbation",
    "dose-limiting",
    "worsen",
    "worsening"
  ];

  const hasMechanisticContradiction = contradictionSignals.some((signal) => mechanismText.includes(signal));
  const hasSevereSafetyConcern = safetyCollapseSignals.some((signal) => mechanismText.includes(signal) || currentUse.includes(signal));
  const veryThinEvidence = input.papers.length <= 1;

  if (highRiskPapers > 0) return "high";
  if (hasMechanisticContradiction && (clinicalEvidence <= 12 || veryThinEvidence)) return "high";
  if (hasSevereSafetyConcern && clinicalEvidence <= 12) return "high";
  if (clinicalEvidence <= 7 && veryThinEvidence) return "high";

  if (clinicalEvidence <= 12 || input.papers.length <= 2) return "medium";
  if (firstGene && clinicalEvidence <= 16) return "medium";
  return "low";
}

function deriveEvidenceBasis(input: { papers: JsonRecord[] }): "direct" | "indirect" | "speculative" {
  if (input.papers.some((paper) => ["high", "medium"].includes(asString(paper.clinical_maturity)))) return "direct";
  if (input.papers.some(paperHasTargetedSourceVerification)) return "direct";
  if (input.papers.length > 0) return "indirect";
  return "speculative";
}

export async function runRedTeamAnalysis(input: {
  query: string;
  literature: JsonRecord;
  pathway: JsonRecord;
  repurposing: JsonRecord;
  evidence: JsonRecord;
}): Promise<RedTeamAnalysisResult> {
  const papersByPmid = new Map(
    asArray<JsonRecord>(input.literature.papers).map((paper) => [asString(paper.pmid), asRecord(paper)])
  );
  const evidenceByDrug = new Map(
    asArray<JsonRecord>(input.evidence.scores).map((entry) => [asString(entry.drug_name).toUpperCase(), asRecord(entry)])
  );

  const deterministicCritiques = asArray<JsonRecord>(input.repurposing.hypotheses).map((hypothesis) => {
    const drugName = asString(hypothesis.drug_name);
    const score = evidenceByDrug.get(drugName.toUpperCase()) ?? {};
    const supportingPmids = asArray<string>(score.supporting_pmids).filter(Boolean);
    const papers = supportingPmids.map((pmid) => papersByPmid.get(pmid)).filter(Boolean) as JsonRecord[];
    const translationRisk = buildTranslationRisk(hypothesis, score);
    const evidenceConfounders = buildEvidenceConfounders({ papers });
    const diseaseSpecificFailure = buildDiseaseSpecificFailure({
      drugName,
      hypothesis,
      pathway: input.pathway
    });
    const disconfirmingSignal = buildDisconfirmingSignal({
      drugName,
      papers,
      pathway: input.pathway
    });
    const criticalTest = buildCriticalTest({
      drugName,
      pathway: input.pathway
    });
    const severity = deriveSeverity({ hypothesis, score, papers, pathway: input.pathway });
    const evidenceBasis = deriveEvidenceBasis({ papers });

    return {
      drug_name: drugName,
      translation_risk: translationRisk,
      evidence_confounders: evidenceConfounders,
      disease_specific_failure: diseaseSpecificFailure,
      failure_mode: diseaseSpecificFailure,
      disconfirming_signal: disconfirmingSignal,
      critical_test: criticalTest,
      severity,
      evidence_basis: evidenceBasis,
      summary: sentence(`${translationRisk} ${evidenceConfounders} ${diseaseSpecificFailure} ${disconfirmingSignal}`)
    } satisfies RedTeamCritique;
  });

  if (isOpenRouterConfigured() && deterministicCritiques.length > 0) {
    try {
      const completion = await callOpenRouterJson<{
        critiques?: RedTeamCritique[];
      }>({
        model: "google/gemini-2.5-flash",
        system:
          "You are a skeptical biomedical critic. Return only strict JSON. " +
          "For each candidate, produce the strongest plausible translation risk, evidence confounders, and disease-specific failure mode. " +
          "Also return a disconfirming signal, a critical test, a severity label (low/medium/high), and an evidence_basis label (direct/indirect/speculative). " +
          "Use severity conservatively: high only for clear mechanism-disease contradiction, severe safety/translation failure risk, or directly conflicting evidence; medium for meaningful but ordinary early-stage uncertainty; low for standard research risk without a strong contradiction signal. " +
          "Be concrete about publication bias, selection bias, endpoint mismatch, PK/PD, tissue exposure, dosing window, BBB penetration, and disease-centrality where relevant. " +
          "Do not invent evidence that is not present in the supplied records.",
        user:
          `Disease: ${input.query}\n` +
          `Pathway summary: ${JSON.stringify(input.pathway)}\n` +
          `Repurposing hypotheses: ${JSON.stringify(input.repurposing.hypotheses)}\n` +
          `Evidence scores: ${JSON.stringify(input.evidence.scores)}\n` +
          `Literature papers: ${JSON.stringify(asArray<JsonRecord>(input.literature.papers).slice(0, 10))}\n` +
          `Deterministic critiques: ${JSON.stringify(deterministicCritiques)}\n` +
          'Return JSON with key "critiques". Each critique must include drug_name, translation_risk, evidence_confounders, disease_specific_failure, failure_mode, disconfirming_signal, critical_test, severity, evidence_basis, summary.'
      });

      const parsed = completion.data ?? {};
      const llmCritiques = Array.isArray(parsed.critiques)
        ? parsed.critiques
            .map((critique) => ({
              drug_name: asString(critique.drug_name),
              translation_risk: sentence(asString(critique.translation_risk)),
              evidence_confounders: sentence(asString(critique.evidence_confounders)),
              disease_specific_failure: sentence(asString(critique.disease_specific_failure)),
              failure_mode: sentence(asString(critique.failure_mode) || asString(critique.disease_specific_failure)),
              disconfirming_signal: sentence(asString(critique.disconfirming_signal)),
              critical_test: sentence(asString(critique.critical_test)),
              severity:
                asString(critique.severity) === "high" || asString(critique.severity) === "medium" || asString(critique.severity) === "low"
                  ? (asString(critique.severity) as "low" | "medium" | "high")
                  : "medium",
              evidence_basis:
                asString(critique.evidence_basis) === "direct" || asString(critique.evidence_basis) === "indirect" || asString(critique.evidence_basis) === "speculative"
                  ? (asString(critique.evidence_basis) as "direct" | "indirect" | "speculative")
                  : "indirect",
              summary: sentence(asString(critique.summary))
            }))
            .filter((critique) => critique.drug_name)
        : [];

      if (llmCritiques.length > 0) {
        return {
          agent: "red_team",
          status: "success",
          critiques: llmCritiques,
          model_used: completion.model,
          synthesis_mode: "llm"
        };
      }
    } catch {
      // Fall back to deterministic critiques if the model is unavailable.
    }
  }

  return {
    agent: "red_team",
    status: "success",
    critiques: deterministicCritiques,
    synthesis_mode: "deterministic"
  };
}
