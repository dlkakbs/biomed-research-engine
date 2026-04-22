import { callOpenRouterJson, isOpenRouterConfigured } from "./openrouter.js";

type JsonRecord = Record<string, unknown>;

interface RepurposingHypothesis {
  drug_name: string;
  molecule_chembl_id: string;
  mechanism_hypothesis: string;
  rationale: string;
  mechanism_overlap: string;
  testable_prediction: string;
  candidate_role: string;
  biomarker_link: string;
  subgroup_link: string;
  supporting_pmids: string[];
  confidence: "low" | "medium" | "high";
  novelty_class: "mainstream" | "novel";
  novelty_basis: string;
  current_use?: string;
  known_disease_asset?: boolean;
  primary_indication_conflict?: boolean;
}

interface FilteredCandidateDebug {
  drug_name: string;
  molecule_chembl_id: string;
  reason_code: string;
  reason_detail: string;
  user_message: string;
}

export interface RepurposingAnalysisResult {
  agent: "repurposing";
  status: "success";
  hypotheses: RepurposingHypothesis[];
  novel_search_note: string;
  model_used?: string;
  synthesis_mode?: "llm" | "deterministic";
  debug?: {
    salvage_applied: boolean;
    filtered_candidates: FilteredCandidateDebug[];
    filter_summary?: Array<{
      reason_code: string;
      count: number;
      user_message: string;
    }>;
  };
}

const DISEASE_ABBREVIATIONS: Record<string, string[]> = {
  huntington: ["hd", "huntington's"],
  "amyotrophic lateral sclerosis": ["als"],
  "multiple sclerosis": ["ms"],
  parkinson: ["pd", "parkinson's"],
  alzheimer: ["ad", "alzheimer's"],
  glioblastoma: ["gbm", "glioblastoma multiforme"]
};

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

function diseaseMatches(diseaseName: string, text: string): boolean {
  const diseaseLower = diseaseName.toLowerCase();
  const combined = text.toLowerCase();
  if (!diseaseLower) return false;
  if (combined.includes(diseaseLower)) return true;
  for (const [fragment, abbreviations] of Object.entries(DISEASE_ABBREVIATIONS)) {
    if (!diseaseLower.includes(fragment)) continue;
    for (const abbreviation of abbreviations) {
      const pattern = new RegExp(`\\b${abbreviation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (pattern.test(combined)) return true;
    }
  }
  return false;
}

function buildCurrentUse(row: JsonRecord) {
  const directUse = asString(row.current_use);
  if (directUse) return directUse;
  const directIndications = asArray<string>(row.current_indications).filter(Boolean).slice(0, 4);
  if (directIndications.length > 0) {
    return `Currently used or clinically studied in ${directIndications.join(", ")}.`;
  }
  const diseases = asArray<JsonRecord>(row.diseases)
    .map((item) => asString(asRecord(item.disease).name))
    .filter(Boolean)
    .slice(0, 4);
  return diseases.length > 0 ? `Currently used or clinically studied in ${diseases.join(", ")}.` : "";
}

function weakDiseaseLinkMessage(parts: string[]) {
  if (parts.length === 0) {
    return "A candidate was reviewed but was not reportable because the available disease link was too weak.";
  }
  if (parts.length === 1) {
    return `A candidate was reviewed but was not reportable because it lacked ${parts[0]}.`;
  }
  if (parts.length === 2) {
    return `A candidate was reviewed but was not reportable because it lacked ${parts[0]} and ${parts[1]}.`;
  }
  const head = parts.slice(0, -1).join(", ");
  const tail = parts[parts.length - 1];
  return `A candidate was reviewed but was not reportable because it lacked ${head}, and ${tail}.`;
}

function candidateContextDecision(candidate: {
  drug_name: string;
  molecule_chembl_id: string;
  max_phase: number;
  source: string;
  origin_tag: string;
  current_indications: string[];
  target_symbol?: string;
}, prioritizedGenes: string[]) {
  const hasIndicationContext = candidate.current_indications.length > 0;
  const hasClinicalMaturity = candidate.max_phase >= 1;
  const hasDirectGeneAnchor =
    Boolean(candidate.target_symbol) &&
    prioritizedGenes.some((gene) => gene.toUpperCase() === candidate.target_symbol?.toUpperCase());
  const hasNonEmptyOrigin = Boolean(candidate.origin_tag);
  const opaqueId = /^CHEMBL\d+$/i.test(candidate.drug_name || candidate.molecule_chembl_id);
  const missingContextParts: string[] = [];
  if (!hasIndicationContext) missingContextParts.push("indication context");
  if (!hasClinicalMaturity) missingContextParts.push("clinical maturity");
  if (!hasDirectGeneAnchor) missingContextParts.push("a direct prioritized gene anchor");
  if (!hasNonEmptyOrigin) missingContextParts.push("clear origin metadata");

  if (opaqueId && !hasIndicationContext && !hasClinicalMaturity && !hasDirectGeneAnchor) {
    return {
      allowed: false,
      reason_code: "filtered:opaque_no_indication_no_phase_no_gene_anchor",
      reason_detail:
        "Candidate was rejected because it is an opaque ChEMBL-style identifier without indication context, clinical maturity, or a direct prioritized gene anchor.",
      user_message: weakDiseaseLinkMessage([
        "interpretable candidate identity",
        "indication context",
        "clinical maturity",
        "a direct prioritized gene anchor"
      ])
    };
  }
  if (candidate.source === "chembl_activity_expansion" && !hasIndicationContext && !hasClinicalMaturity && !hasDirectGeneAnchor) {
    return {
      allowed: false,
      reason_code: "filtered:chembl_activity_no_indication_no_phase_no_gene_anchor",
      reason_detail:
        "ChEMBL activity expansion candidate was rejected because it lacked indication context, clinical maturity, and a direct prioritized gene anchor.",
      user_message: weakDiseaseLinkMessage([
        "indication context",
        "clinical maturity",
        "a direct prioritized gene anchor"
      ])
    };
  }
  if (!hasIndicationContext && !hasClinicalMaturity && !hasDirectGeneAnchor && !hasNonEmptyOrigin) {
    return {
      allowed: false,
      reason_code: "filtered:no_indication_no_phase_no_gene_anchor_no_origin",
      reason_detail:
        "Candidate was rejected because it lacked indication context, clinical maturity, a direct prioritized gene anchor, and any non-empty origin tag.",
      user_message: weakDiseaseLinkMessage(missingContextParts)
    };
  }
  return {
    allowed: true,
    reason_code: "",
    reason_detail: "",
    user_message: ""
  };
}

function normalizeCandidateRows(drugdb: JsonRecord, prioritizedGenes: string[]) {
  const expanded = asArray<JsonRecord>(drugdb.expanded_candidates).map((row) => {
    const drugName = asString(row.drug_name);
    const moleculeId = asString(row.molecule_chembl_id);
    const indications = asArray<string>(row.current_indications).filter(Boolean);
    const targetSymbol = asString(row.target_symbol);
    return {
      row,
      drug_name: drugName,
      molecule_chembl_id: moleculeId,
      max_phase: asNumber(row.max_phase),
      source: asString(row.source),
      origin_tag: asString(row.origin_tag),
      current_indications: indications,
      target_symbol: targetSymbol
    };
  });
  if (expanded.length > 0) {
    const filteredCandidates: FilteredCandidateDebug[] = [];
    const rows = expanded
      .filter((item) => {
        if (!(item.drug_name || item.molecule_chembl_id)) return false;
        const opaqueId = /^CHEMBL\d+$/i.test(item.drug_name || item.molecule_chembl_id);
        const hasContext = item.current_indications.length > 0 || item.max_phase > 0 || Boolean(item.target_symbol);
        if (opaqueId && !hasContext) {
          filteredCandidates.push({
            drug_name: item.drug_name,
            molecule_chembl_id: item.molecule_chembl_id,
            reason_code: "filtered:opaque_no_context",
            reason_detail:
              "Candidate was rejected because it resolved only to an opaque ChEMBL identifier without indication, phase, or target context.",
            user_message: weakDiseaseLinkMessage([
              "interpretable candidate identity",
              "indication context",
              "clinical maturity",
              "target context"
            ])
          });
          return false;
        }
        const decision = candidateContextDecision(item, prioritizedGenes);
        if (!decision.allowed) {
          filteredCandidates.push({
            drug_name: item.drug_name,
            molecule_chembl_id: item.molecule_chembl_id,
            reason_code: decision.reason_code,
            reason_detail: decision.reason_detail,
            user_message: decision.user_message
          });
        }
        return decision.allowed;
      })
      .sort((left, right) => {
        const leftGeneMatch = prioritizedGenes.some((gene) => gene.toUpperCase() === left.target_symbol?.toUpperCase()) ? 1 : 0;
        const rightGeneMatch = prioritizedGenes.some((gene) => gene.toUpperCase() === right.target_symbol?.toUpperCase()) ? 1 : 0;
        return (
          rightGeneMatch - leftGeneMatch ||
          right.max_phase - left.max_phase ||
          right.current_indications.length - left.current_indications.length ||
          left.drug_name.localeCompare(right.drug_name)
        );
      })
      .slice(0, 18);
    const filterSummary = Object.values(
      filteredCandidates.reduce<Record<string, { reason_code: string; count: number; user_message: string }>>((acc, item) => {
        const key = item.reason_code || "filtered:other";
        if (!acc[key]) {
          acc[key] = {
            reason_code: key,
            count: 0,
            user_message: item.user_message
          };
        }
        acc[key].count += 1;
        return acc;
      }, {})
    ).sort((left, right) => right.count - left.count || left.reason_code.localeCompare(right.reason_code));

    return {
      rows,
      filtered_candidates: filteredCandidates,
      expanded_count: expanded.length,
      filter_summary: filterSummary
    };
  }

  return {
    rows: asArray<JsonRecord>(drugdb.opentargets_drugs).map((row) => {
      const drug = asRecord(row.drug);
      return {
        row,
        drug_name: asString(drug.name) || asString(drug.id),
        molecule_chembl_id: asString(drug.id),
        max_phase: Math.max(asNumber(row.maxClinicalStage), asNumber(drug.maximumClinicalStage)),
        source: "opentargets",
        origin_tag: ""
      };
    }).slice(0, 12),
    filtered_candidates: [],
    expanded_count: 0,
    filter_summary: []
  };
}

function topPmids(literature: JsonRecord, count: number) {
  return asArray<JsonRecord>(literature.papers)
    .sort((left, right) => asNumber(right.citation_count) - asNumber(left.citation_count) || asNumber(right.year) - asNumber(left.year))
    .slice(0, count)
    .map((paper) => asString(paper.pmid))
    .filter(Boolean);
}

function pathwayGenes(pathway: JsonRecord) {
  const first = asRecord(asArray<JsonRecord>(pathway.genetic_evidence)[0]);
  return asArray<string>(first.prioritized_genes).filter(Boolean).slice(0, 5);
}

function pathwayNames(pathway: JsonRecord) {
  return asArray<JsonRecord>(pathway.pathways)
    .map((item) => asString(item.pathway_name))
    .filter(Boolean)
    .slice(0, 8);
}

function trialHints(pathway: JsonRecord) {
  return asArray<JsonRecord>(pathway.clinical_trials)
    .map((trial) => ({
      title: asString(trial.title),
      phase: asString(trial.phase),
      drugs: asArray<string>(trial.drugs).filter(Boolean)
    }))
    .filter((trial) => trial.title || trial.drugs.length > 0)
    .slice(0, 8);
}

export async function runRepurposingAnalysis(input: {
  query: string;
  literature: JsonRecord;
  drugdb: JsonRecord;
  pathway: JsonRecord;
}): Promise<RepurposingAnalysisResult> {
  const genes = pathwayGenes(input.pathway);
  const pathways = pathwayNames(input.pathway);
  const trials = trialHints(input.pathway);
  const pmids = topPmids(input.literature, 3);
  const normalized = normalizeCandidateRows(input.drugdb, genes);
  let rows = normalized.rows;
  const filteredCandidates = normalized.filtered_candidates;
  const filterSummary = normalized.filter_summary;
  let salvageApplied = false;

  if (rows.length === 0 && normalized.expanded_count === 1 && filteredCandidates.length === 1) {
    const loneExpanded = asRecord(asArray<JsonRecord>(input.drugdb.expanded_candidates)[0]);
    const drugName = asString(loneExpanded.drug_name);
    const moleculeId = asString(loneExpanded.molecule_chembl_id);
    const targetSymbol = asString(loneExpanded.target_symbol);
    const hasPathwayAnchor = pathways.length > 0;
    const hasLiteratureAnchor = pmids.length > 0;

    if ((drugName || moleculeId) && hasLiteratureAnchor && (Boolean(targetSymbol) || hasPathwayAnchor)) {
      rows = [{
        row: loneExpanded,
        drug_name: drugName,
        molecule_chembl_id: moleculeId,
        max_phase: asNumber(loneExpanded.max_phase),
        source: asString(loneExpanded.source),
        origin_tag: asString(loneExpanded.origin_tag),
        current_indications: asArray<string>(loneExpanded.current_indications).filter(Boolean),
        target_symbol: targetSymbol
      }];
      salvageApplied = true;
    }
  }

  const hypotheses = rows.map((candidate, index) => {
    const row = candidate.row;
    const drug = asRecord(row.drug);
    const drugName = candidate.drug_name || asString(drug.name) || asString(drug.id) || `Candidate-${index + 1}`;
    const moleculeId = candidate.molecule_chembl_id || asString(drug.id);
    const currentUse = buildCurrentUse(row);
    const knownDiseaseAsset = diseaseMatches(input.query, currentUse);
    const maxClinicalStage = Math.max(candidate.max_phase, asNumber(row.maxClinicalStage), asNumber(drug.maximumClinicalStage));
    const crossIndication = !knownDiseaseAsset && Boolean(currentUse);
    const geneAnchor = genes.length > 0 ? genes[index % genes.length] : "";
    const pathwayAnchor = pathways.length > 0 ? pathways[index % pathways.length] : "disease-linked pathway biology";
    const trialAnchor = trials.length > 0 ? trials[index % trials.length] : null;
    const indicationAnchor = currentUse.replace(/^Currently used or clinically studied in /, "").replace(/\.$/, "");
    const sourceLabel =
      candidate.source === "chembl_activity_expansion"
        ? "activity-led expansion"
        : candidate.source === "opentargets_expansion"
          ? "target-linked expansion"
          : "disease-linked screening";
    const originTag = candidate.origin_tag ? `${candidate.origin_tag} history` : "non-native indication history";
    const noveltyClass: "mainstream" | "novel" =
      crossIndication && pmids.length >= 2 && index < 2 ? "novel" : "mainstream";
    const confidence: "low" | "medium" | "high" =
      salvageApplied || knownDiseaseAsset ? "low" : maxClinicalStage >= 3 ? "high" : maxClinicalStage >= 1 ? "medium" : "low";

    return {
      drug_name: drugName,
      molecule_chembl_id: moleculeId,
      mechanism_hypothesis: sentence(
        knownDiseaseAsset
          ? `${drugName} remains in the list as a disease-native comparator because its current use already overlaps with ${input.query}.`
          : salvageApplied
            ? `${drugName} is retained as a mechanism-first salvage candidate because it is the only expanded candidate in this run and still preserves a disease-relevant target or pathway anchor for ${input.query}.`
          : `${drugName} is prioritized from the ${sourceLabel} layer because its existing use in ${indicationAnchor || originTag} may intersect with ${pathwayAnchor}${geneAnchor ? ` via ${geneAnchor}` : ""}.`
      ),
      rationale: sentence(
        knownDiseaseAsset
          ? `${drugName} appears to be a known disease-native asset for ${input.query}, so it is retained for context but not treated as a clean repurposing discovery.`
          : salvageApplied
            ? `${drugName} would normally be filtered for limited indication or clinical context, but it was retained as the only mechanism-linked candidate with usable disease anchoring in this run.`
          : `${drugName} is kept because the current pass suggests a plausible cross-indication angle from ${indicationAnchor || originTag} into ${input.query}, rather than a disease-native optimization.`
      ),
      mechanism_overlap: sentence(
        geneAnchor
          ? `${drugName} is linked to the disease-biology layer through ${pathwayAnchor}, the supportive gene signal ${geneAnchor}, and the ${sourceLabel} candidate expansion.`
          : `${drugName} is linked to ${pathwayAnchor} in the current disease pathway pass.`
      ),
      testable_prediction: sentence(
        `If this hypothesis is correct, biomarkers or assay readouts tied to ${pathwayAnchor}${geneAnchor ? ` and ${geneAnchor}` : ""} should shift after ${drugName} exposure in ${input.query} models.`
      ),
      candidate_role: knownDiseaseAsset
        ? "known disease asset comparator"
        : salvageApplied
          ? "mechanism-first salvage candidate"
        : trialAnchor?.phase
          ? `cross-indication candidate with adjacent clinical context (${trialAnchor.phase || "active trial context"})`
          : candidate.source === "chembl_activity_expansion"
            ? "mechanism-first repurposing candidate"
            : "cross-indication repurposing candidate",
      biomarker_link: noveltyClass === "novel" ? `Track biomarker movement around ${pathwayAnchor}${geneAnchor ? ` / ${geneAnchor}` : ""}.` : "",
      subgroup_link:
        noveltyClass === "novel"
          ? geneAnchor
            ? `${geneAnchor}-enriched or pathway-positive subgroup.`
            : "Mechanism-enriched subgroup."
          : "",
      supporting_pmids: pmids,
      confidence,
      novelty_class: noveltyClass,
      novelty_basis:
        noveltyClass === "novel"
          ? `Selected as a cross-indication hypothesis anchored in ${indicationAnchor || originTag} rather than a disease-native asset.`
          : "",
      current_use: currentUse,
      known_disease_asset: knownDiseaseAsset,
      primary_indication_conflict: knownDiseaseAsset
    } satisfies RepurposingHypothesis;
  });

  const sortHypotheses = (items: RepurposingHypothesis[]) => items.sort((left, right) => {
    if (left.known_disease_asset !== right.known_disease_asset) {
      return left.known_disease_asset ? 1 : -1;
    }
    const confidenceRank = { high: 3, medium: 2, low: 1 };
    return confidenceRank[right.confidence] - confidenceRank[left.confidence] || left.drug_name.localeCompare(right.drug_name);
  });

  const deterministicSorted = sortHypotheses(hypotheses);
  const deterministicTopFive = deterministicSorted.slice(0, 5);
  const deterministicCrossIndicationCount = deterministicTopFive.filter((item) => !item.known_disease_asset).length;
  const deterministicDominantNative =
    deterministicSorted.filter((item) => item.known_disease_asset).length >= Math.ceil(deterministicSorted.length / 2);
  const deterministicNovelSearchNote =
    deterministicDominantNative && deterministicCrossIndicationCount < 3
      ? "Most available compounds in the current data are disease-native assets; cross-indication candidates are limited, so lower-confidence cross-indication options were retained where possible."
      : deterministicCrossIndicationCount >= 3
        ? "Cross-indication candidates dominate the top of the shortlist, while disease-native assets were labeled and pushed lower."
        : "Novelty search ran, but the current data supports only a limited number of cross-indication candidates.";
  const finalNovelSearchNote = sentence(
    [
      deterministicNovelSearchNote,
      salvageApplied
        ? "A single-candidate salvage rule was applied because only one expanded candidate survived upstream collection; it was retained as a low-confidence mechanism-first hypothesis rather than dropped to zero."
        : ""
    ].filter(Boolean).join(" ")
  );

  if (isOpenRouterConfigured() && rows.length > 0) {
    try {
      const completion = await callOpenRouterJson<{
        hypotheses?: RepurposingHypothesis[];
        novel_search_note?: string;
      }>({
        model: "qwen/qwen3-30b-a3b-instruct-2507",
        system:
          "You are a biomedical repurposing analyst. Return only strict JSON. " +
          "Prioritize genuine cross-indication repurposing ideas. Apply these hard rules: " +
          "if current_use references the queried disease directly or by abbreviation, set known_disease_asset=true and primary_indication_conflict=true and rank it at the bottom; " +
          "try to ensure at least 3 of the top 5 are non-disease-native when the data permits; " +
          'set novelty_class="novel" only for genuine cross-indication mechanism transfer, not trivial disease-adjacent biology. ' +
          "Do not fabricate PMIDs, mechanisms, or indications.",
        user:
          `Disease: ${input.query}\n` +
          `Top literature PMIDs: ${JSON.stringify(pmids)}\n` +
          `Genes: ${JSON.stringify(genes)}\n` +
          `Pathways: ${JSON.stringify(pathways)}\n` +
          `Trial hints: ${JSON.stringify(trials)}\n` +
          `Drug rows: ${JSON.stringify(rows)}\n` +
          `Deterministic shortlist: ${JSON.stringify(deterministicSorted.slice(0, 8))}\n` +
          'Return JSON with keys "hypotheses" and "novel_search_note". ' +
          'Each hypothesis must include: drug_name, molecule_chembl_id, mechanism_hypothesis, rationale, mechanism_overlap, testable_prediction, candidate_role, biomarker_link, subgroup_link, supporting_pmids, confidence, novelty_class, novelty_basis, current_use, known_disease_asset, primary_indication_conflict.'
      });

      const parsed = completion.data ?? {};
      const llmHypotheses = Array.isArray(parsed.hypotheses)
        ? parsed.hypotheses
            .map((item, index) => {
              const drugName = asString(item.drug_name) || deterministicSorted[index]?.drug_name || `Candidate-${index + 1}`;
              const currentUse = asString(item.current_use);
              const knownDiseaseAsset =
                item.known_disease_asset === true ||
                item.primary_indication_conflict === true ||
                diseaseMatches(input.query, currentUse);
              return {
                drug_name: drugName,
                molecule_chembl_id: asString(item.molecule_chembl_id),
                mechanism_hypothesis: sentence(asString(item.mechanism_hypothesis) || deterministicSorted[index]?.mechanism_hypothesis || ""),
                rationale: sentence(asString(item.rationale) || deterministicSorted[index]?.rationale || ""),
                mechanism_overlap: sentence(asString(item.mechanism_overlap) || deterministicSorted[index]?.mechanism_overlap || ""),
                testable_prediction: sentence(asString(item.testable_prediction) || deterministicSorted[index]?.testable_prediction || ""),
                candidate_role: sentence(asString(item.candidate_role) || deterministicSorted[index]?.candidate_role || ""),
                biomarker_link: sentence(asString(item.biomarker_link) || ""),
                subgroup_link: sentence(asString(item.subgroup_link) || ""),
                supporting_pmids: asArray<string>(item.supporting_pmids).map(String).filter(Boolean).slice(0, 5),
                confidence: asString(item.confidence) === "high" || asString(item.confidence) === "medium" ? asString(item.confidence) as "high" | "medium" : "low",
                novelty_class: asString(item.novelty_class) === "novel" ? "novel" : "mainstream",
                novelty_basis: sentence(asString(item.novelty_basis) || ""),
                current_use: currentUse,
                known_disease_asset: knownDiseaseAsset,
                primary_indication_conflict: knownDiseaseAsset
              } satisfies RepurposingHypothesis;
            })
            .filter((item) => item.drug_name)
        : [];

      if (llmHypotheses.length > 0) {
        return {
          agent: "repurposing",
          status: "success",
          hypotheses: sortHypotheses(llmHypotheses).slice(0, 8),
          novel_search_note: asString(parsed.novel_search_note) || finalNovelSearchNote,
          model_used: completion.model,
          synthesis_mode: "llm",
          debug: {
            salvage_applied: salvageApplied,
            filtered_candidates: filteredCandidates,
            filter_summary: filterSummary
          }
        };
      }
    } catch {
      // Fall back to deterministic ranking if the model is unavailable.
    }
  }

  return {
    agent: "repurposing",
    status: "success",
    hypotheses: deterministicSorted.slice(0, 8),
    novel_search_note: finalNovelSearchNote,
    synthesis_mode: "deterministic",
    debug: {
      salvage_applied: salvageApplied,
      filtered_candidates: filteredCandidates,
      filter_summary: filterSummary
    }
  };
}
