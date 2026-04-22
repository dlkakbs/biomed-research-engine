import { callOpenRouterJson, isOpenRouterConfigured } from "./openrouter.js";

type JsonRecord = Record<string, unknown>;

interface EvidenceScore {
  drug_name: string;
  molecule_chembl_id: string;
  score: number;
  breakdown: {
    literature_support: number;
    mechanism_overlap: number;
    clinical_evidence: number;
    safety_profile: number;
  };
  supporting_pmids: string[];
  nct_ids: string[];
  rationale: string;
}

export interface EvidenceAnalysisResult {
  agent: "evidence_scorer";
  status: "success";
  scores: EvidenceScore[];
  model_used?: string;
  synthesis_mode?: "llm" | "deterministic";
}

function computeGeneticBonus(score: number): number {
  if (score > 0.7) return 5;
  if (score > 0.5) return 2;
  return 0;
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sentence(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textIncludesToken(text: string, token: string): boolean {
  const normalizedText = sentence(text).toLowerCase();
  const normalizedToken = sentence(token).toLowerCase();
  if (!normalizedText || !normalizedToken) return false;
  if (normalizedToken.length <= 6) {
    return new RegExp(`\\b${escapeRegExp(normalizedToken)}\\b`, "i").test(normalizedText);
  }
  return normalizedText.includes(normalizedToken);
}

function paperEvidenceSnippets(paper: JsonRecord): string[] {
  return asArray<string>(paper.evidence_snippets).map(asString).filter(Boolean);
}

function paperEvidenceText(paper: JsonRecord): string {
  const snippets = paperEvidenceSnippets(paper);
  if (snippets.length > 0) {
    return sentence(`${asString(paper.title)} ${snippets.join(" ")}`);
  }
  return sentence(`${asString(paper.title)} ${asString(paper.abstract)}`);
}

function paperHasTargetedSourceVerification(paper: JsonRecord): boolean {
  return asString(paper.content_level) === "full_text" && paperEvidenceSnippets(paper).length > 0;
}

export async function runEvidenceScoring(input: {
  query: string;
  literature: JsonRecord;
  pathway: JsonRecord;
  repurposing: JsonRecord;
}): Promise<EvidenceAnalysisResult> {
  const paperMap = new Map(
    asArray<JsonRecord>(input.literature.papers).map((paper) => [asString(paper.pmid), asRecord(paper)])
  );
  const topTrialIds = asArray<JsonRecord>(input.pathway.clinical_trials)
    .slice(0, 3)
    .map((trial) => asString(trial.nct_id))
    .filter(Boolean);
  const genetic = asRecord(asArray<JsonRecord>(input.pathway.genetic_evidence)[0]);
  const geneticGenes = asArray<string>(genetic.prioritized_genes).slice(0, 3);
  const geneticScore = asNumber(genetic.genetic_support_score);
  const geneticBonus = computeGeneticBonus(geneticScore);

  const deterministicScores = asArray<JsonRecord>(input.repurposing.hypotheses).map((hypothesis) => {
    const supportingPmids = asArray<string>(hypothesis.supporting_pmids).filter(Boolean);
    const papers = supportingPmids.map((pmid) => paperMap.get(pmid)).filter(Boolean) as JsonRecord[];
    const highStrength = papers.filter((paper) => asString(paper.evidence_strength) === "high").length;
    const mediumStrength = papers.filter((paper) => asString(paper.evidence_strength) === "medium").length;
    const clinicalMaturity = papers.filter((paper) => ["high", "medium"].includes(asString(paper.clinical_maturity))).length;
    const riskFlags = papers.filter((paper) => ["high", "medium"].includes(asString(paper.risk_level))).length;
    const verifiedPaperCount = papers.filter(paperHasTargetedSourceVerification).length;
    const hypothesisText = sentence(
      [
        asString(hypothesis.mechanism_hypothesis),
        asString(hypothesis.mechanism_overlap),
        asString(hypothesis.rationale),
        asString(hypothesis.biomarker_link),
        asString(hypothesis.subgroup_link)
      ].join(" ")
    );
    const matchedGeneticAnchors = geneticGenes.filter((gene) => textIncludesToken(hypothesisText, gene));
    const candidateMentionCount = papers.filter((paper) => {
      const text = paperEvidenceText(paper);
      return (
        textIncludesToken(text, asString(hypothesis.drug_name)) ||
        textIncludesToken(text, asString(hypothesis.molecule_chembl_id))
      );
    }).length;
    const pathwayAnchored =
      asArray<JsonRecord>(input.pathway.pathways).length > 0 &&
      !hypothesisText.toLowerCase().includes("disease-linked pathway biology");

    let literatureSupport = clamp(papers.length * 5 + highStrength * 5 + mediumStrength * 2 + clinicalMaturity * 2, 0, 30);
    if (candidateMentionCount === 0) {
      literatureSupport = Math.min(literatureSupport, papers.length > 0 ? 8 : 0);
    }
    const mechanismBase =
      asString(hypothesis.known_disease_asset) === "true" || hypothesis.known_disease_asset === true
        ? 14
        : matchedGeneticAnchors.length > 0
          ? 18
          : pathwayAnchored
            ? 12
            : 6;
    const noveltyClass = asString(hypothesis.novelty_class);
    const mechanismOverlap = clamp(mechanismBase + geneticBonus + (noveltyClass === "novel" ? 1 : 0), 0, 30);
    const confidence = asString(hypothesis.confidence);
    const clinicalEvidence = clamp(confidence === "high" ? 18 : confidence === "medium" ? 12 : 7, 0, 25);
    const safetyProfile = clamp(12 - riskFlags * 2 - (hypothesis.known_disease_asset ? 1 : 0), 0, 15);
    const total = clamp(literatureSupport + mechanismOverlap + clinicalEvidence + safetyProfile, 0, 100);

    return {
      drug_name: asString(hypothesis.drug_name),
      molecule_chembl_id: asString(hypothesis.molecule_chembl_id),
      score: total,
      breakdown: {
        literature_support: literatureSupport,
        mechanism_overlap: mechanismOverlap,
        clinical_evidence: clinicalEvidence,
        safety_profile: safetyProfile
      },
      supporting_pmids: supportingPmids,
      nct_ids: topTrialIds,
      rationale: sentence(
        `${asString(hypothesis.rationale)} Literature support is based on ${supportingPmids.length} PMID-linked papers. ` +
          (verifiedPaperCount > 0
            ? `Targeted source verification was available for ${verifiedPaperCount} of those paper(s). `
            : "") +
          (candidateMentionCount === 0
            ? "None of the supporting papers directly mention this candidate, so literature support was capped and treated as disease-context evidence rather than candidate-specific validation. "
            : "") +
          (noveltyClass === "novel"
            ? " This candidate is being treated as a novelty-bearing cross-indication hypothesis rather than a disease-native comparator."
            : "") +
          (geneticGenes.length > 0
            ? geneticBonus > 0
              ? `Supportive disease-biology context includes ${geneticGenes.join(", ")} from ${asString(genetic.source_gwas)}, which contributed a +${geneticBonus} mechanism bonus from the current genetic support score (${geneticScore.toFixed(3)}).`
              : `Supportive disease-biology context includes ${geneticGenes.join(", ")} from ${asString(genetic.source_gwas)}, but the score remained below the threshold for an added mechanism bonus (${geneticScore.toFixed(3)}).`
            : "No genetic anchor was available in this run; ranking remains mechanism-led without a genetic bonus.")
      )
    } satisfies EvidenceScore;
  });

  deterministicScores.sort((left, right) => right.score - left.score || left.drug_name.localeCompare(right.drug_name));

  if (isOpenRouterConfigured() && deterministicScores.length > 0) {
    try {
      const completion = await callOpenRouterJson<{
        scores?: EvidenceScore[];
      }>({
        model: "openai/gpt-4o",
        system:
          "You are a biomedical evidence scorer. Return only strict JSON. " +
          "Score each candidate on literature_support (0-30), mechanism_overlap (0-30), clinical_evidence (0-25), safety_profile (0-15), and total score (0-100). " +
          "Respect the supplied genetic support note and novelty/known-disease-asset labels. Do not fabricate PMIDs or trials. Be conservative with weak evidence.",
        user:
          `Disease: ${input.query}\n` +
          `Genetic evidence: ${JSON.stringify(input.pathway.genetic_evidence)}\n` +
          `Clinical trials: ${JSON.stringify(input.pathway.clinical_trials)}\n` +
          `Literature papers: ${JSON.stringify(asArray<JsonRecord>(input.literature.papers).slice(0, 10))}\n` +
          `Repurposing hypotheses: ${JSON.stringify(input.repurposing.hypotheses)}\n` +
          `Deterministic scores: ${JSON.stringify(deterministicScores)}\n` +
          'Return JSON with key "scores". Each entry must include drug_name, molecule_chembl_id, score, breakdown, supporting_pmids, nct_ids, rationale.'
      });

      const parsed = completion.data ?? {};
      const llmScores = Array.isArray(parsed.scores)
        ? parsed.scores
            .map((entry) => {
              const breakdown = asRecord(entry.breakdown);
              const literatureSupport = clamp(asNumber(breakdown.literature_support), 0, 30);
              const mechanismOverlap = clamp(asNumber(breakdown.mechanism_overlap), 0, 30);
              const clinicalEvidence = clamp(asNumber(breakdown.clinical_evidence), 0, 25);
              const safetyProfile = clamp(asNumber(breakdown.safety_profile), 0, 15);
              const total = clamp(
                asNumber(entry.score) || (literatureSupport + mechanismOverlap + clinicalEvidence + safetyProfile),
                0,
                100
              );
              return {
                drug_name: asString(entry.drug_name),
                molecule_chembl_id: asString(entry.molecule_chembl_id),
                score: total,
                breakdown: {
                  literature_support: literatureSupport,
                  mechanism_overlap: mechanismOverlap,
                  clinical_evidence: clinicalEvidence,
                  safety_profile: safetyProfile
                },
                supporting_pmids: asArray<string>(entry.supporting_pmids).map(String).filter(Boolean).slice(0, 5),
                nct_ids: asArray<string>(entry.nct_ids).map(String).filter(Boolean).slice(0, 5),
                rationale: sentence(asString(entry.rationale))
              } satisfies EvidenceScore;
            })
            .filter((entry) => entry.drug_name)
        : [];

      if (llmScores.length > 0) {
        llmScores.sort((left, right) => right.score - left.score || left.drug_name.localeCompare(right.drug_name));
        return {
          agent: "evidence_scorer",
          status: "success",
          scores: llmScores,
          model_used: completion.model,
          synthesis_mode: "llm"
        };
      }
    } catch {
      // Fall back to deterministic scoring if the model is unavailable.
    }
  }

  return {
    agent: "evidence_scorer",
    status: "success",
    scores: deterministicScores,
    synthesis_mode: "deterministic"
  };
}
