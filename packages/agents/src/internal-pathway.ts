import { callOpenRouterJson, isOpenRouterConfigured } from "./openrouter.js";

interface PathwayTarget {
  target_id: string;
  symbol: string;
  name: string;
  score: number;
}

interface PathwayRow {
  pathway_id: string;
  pathway_name: string;
  related_genes: string[];
  relevance: number;
}

interface ClinicalTrialRow {
  nct_id: string;
  title: string;
  phase: string;
  status: string;
  drugs: string[];
}

interface GeneticLocusRow {
  snp_id: string;
  chromosome: string;
  position: number;
  p_value: number;
  mapped_gene: string;
  source_pmid: string;
}

interface GeneticEvidenceRow {
  disorder: string;
  source_gwas: string;
  prioritized_genes: string[];
  top_loci: GeneticLocusRow[];
  genetic_support_score: number;
  note: string;
}

export interface PathwayAnalysisResult {
  agent: "pathway";
  status: "success";
  pathways: PathwayRow[];
  genetic_evidence: GeneticEvidenceRow[];
  clinical_trials: ClinicalTrialRow[];
  model_used?: string;
  synthesis_mode?: "llm" | "deterministic";
}

const OPENTARGETS_URL = "https://api.platform.opentargets.org/api/v4/graphql";
const CLINICAL_TRIALS_URL = "https://clinicaltrials.gov/api/v2/studies";
const PATHWAY_FETCH_TIMEOUT_MS = 12_000;
const OFF_TOPIC_PATHWAY_PATTERNS = [
  /\bpotential therapeutics? for\b/i,
  /\bsars\b/i,
  /\bcovid\b/i,
  /\bcoronavirus\b/i,
  /\binfluenza\b/i,
  /\bhiv\b/i,
  /\bviral\b/i,
  /\bhepatitis\b/i,
  /\bebola\b/i,
  /\bdengue\b/i,
  /\bzika\b/i
] as const;
const DISEASE_ALIAS_MAP: Record<string, string[]> = {
  "fibrodysplasia ossificans progressiva": [
    "fop",
    "myositis ossificans progressiva",
    "myositis ossificans progressive"
  ]
};

function isPathwayLlmEnabled(): boolean {
  const value = process.env.PATHWAY_ENABLE_LLM?.trim().toLowerCase();
  return value !== "0" && value !== "false" && value !== "no";
}

function createTimeoutSignal(timeoutMs = PATHWAY_FETCH_TIMEOUT_MS) {
  return AbortSignal.timeout(timeoutMs);
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function stripParenthetical(value: string) {
  return normalizeText(value.replace(/\([^)]*\)/g, " "));
}

function buildDiseaseTerms(query: string): string[] {
  return normalizeText(stripParenthetical(query))
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((term) => term.length >= 3)
    .filter((term) => !["disease", "syndrome", "disorder", "progressive", "type"].includes(term));
}

function buildDiseaseAliases(query: string): string[] {
  const aliases = new Set<string>();
  const normalized = normalizeText(query);
  if (normalized) {
    aliases.add(normalized);
    aliases.add(stripParenthetical(normalized));
    for (const match of normalized.matchAll(/\(([^)]+)\)/g)) {
      const alias = normalizeText(match[1] ?? "");
      if (alias) aliases.add(alias);
    }
  }

  const lowered = [...aliases].map((value) => value.toLowerCase());
  for (const [canonical, mappedAliases] of Object.entries(DISEASE_ALIAS_MAP)) {
    if (lowered.some((value) => value === canonical || mappedAliases.includes(value))) {
      aliases.add(canonical);
      for (const alias of mappedAliases) aliases.add(alias);
    }
  }

  return [...aliases].filter(Boolean);
}

async function postOpenTargets<T>(query: string, variables: Record<string, unknown>) {
  const response = await fetch(OPENTARGETS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: createTimeoutSignal()
  });
  if (!response.ok) {
    throw new Error(`opentargets_request_failed:${response.status}`);
  }
  return (await response.json()) as T;
}

async function searchDisease(query: string) {
  for (const alias of buildDiseaseAliases(query)) {
    const data = await postOpenTargets<{
      data?: { search?: { hits?: Array<{ id?: string; name?: string }> } };
    }>(
      `query SearchDisease($query: String!) {
        search(queryString: $query, entityNames: ["disease"], page: { index: 0, size: 3 }) {
          hits { id name }
        }
      }`,
      { query: alias }
    );
    const hit = data.data?.search?.hits?.[0] ?? null;
    if (hit?.id) return hit;
  }
  return null;
}

async function getDiseaseTargets(diseaseId: string): Promise<PathwayTarget[]> {
  const data = await postOpenTargets<{
    data?: {
      disease?: {
        associatedTargets?: {
          rows?: Array<{
            score?: number;
            target?: { id?: string; approvedSymbol?: string; approvedName?: string };
          }>;
        };
      };
    };
  }>(
    `query DiseaseTargets($diseaseId: String!) {
      disease(efoId: $diseaseId) {
        associatedTargets(page: { index: 0, size: 10 }) {
          rows {
            score
            target { id approvedSymbol approvedName }
          }
        }
      }
    }`,
    { diseaseId }
  );

  return (data.data?.disease?.associatedTargets?.rows ?? [])
    .map((row) => ({
      target_id: String(row.target?.id ?? ""),
      symbol: String(row.target?.approvedSymbol ?? ""),
      name: String(row.target?.approvedName ?? ""),
      score: Number(row.score ?? 0)
    }))
    .filter((row) => row.target_id && row.symbol && row.score > 0.3);
}

async function getTargetPathways(targetId: string) {
  const data = await postOpenTargets<{
    data?: {
      target?: {
        pathways?: Array<{ pathwayId?: string; pathway?: string }>;
      };
    };
  }>(
    `query TargetPathways($targetId: String!) {
      target(ensemblId: $targetId) {
        pathways { pathwayId pathway }
      }
    }`,
    { targetId }
  );
  return data.data?.target?.pathways ?? [];
}

function computePathwayPenalty(query: string, pathwayName: string) {
  const normalizedName = normalizeText(pathwayName).toLowerCase();
  if (!normalizedName) return 0;

  const diseaseTerms = buildDiseaseTerms(query);
  const queryMatchesOffTopicTerm = OFF_TOPIC_PATHWAY_PATTERNS.some((pattern) => pattern.test(query));
  let penalty = 0;
  if (!queryMatchesOffTopicTerm && OFF_TOPIC_PATHWAY_PATTERNS.some((pattern) => pattern.test(normalizedName))) {
    penalty += 0.35;
  }
  if (normalizedName.length < 12 && diseaseTerms.every((term) => !normalizedName.includes(term))) {
    penalty += 0.08;
  }
  return penalty;
}

function aggregatePathways(
  query: string,
  targets: PathwayTarget[],
  pathwayHits: Array<{ target: PathwayTarget; pathwayId: string; pathwayName: string }>
): PathwayRow[] {
  const pathwayMap = new Map<string, {
    pathway_name: string;
    related_genes: Set<string>;
    max_relevance: number;
    cumulative_relevance: number;
    hit_count: number;
  }>();
  for (const hit of pathwayHits) {
    const key = hit.pathwayId || hit.pathwayName;
    if (!key) continue;
    const current = pathwayMap.get(key) ?? {
      pathway_name: hit.pathwayName,
      related_genes: new Set<string>(),
      max_relevance: 0,
      cumulative_relevance: 0,
      hit_count: 0
    };
    current.related_genes.add(hit.target.symbol);
    current.max_relevance = Math.max(current.max_relevance, hit.target.score);
    current.cumulative_relevance += hit.target.score;
    current.hit_count += 1;
    pathwayMap.set(key, current);
  }

  return [...pathwayMap.entries()]
    .map(([pathway_id, value]) => {
      const geneCount = value.related_genes.size;
      const penalty = computePathwayPenalty(query, value.pathway_name);
      const coverageBonus = Math.min(0.12, Math.max(0, geneCount - 1) * 0.04);
      const repeatHitBonus = Math.min(0.08, Math.max(0, value.hit_count - 1) * 0.02);
      const relevance = Math.max(0, value.max_relevance + coverageBonus + repeatHitBonus - penalty);
      return {
        pathway_id,
        pathway_name: value.pathway_name,
        related_genes: [...value.related_genes].slice(0, 8),
        relevance: Number(relevance.toFixed(3))
      };
    })
    .filter((row) => row.relevance > 0)
    .sort((left, right) => right.relevance - left.relevance || right.related_genes.length - left.related_genes.length)
    .slice(0, 10);
}

function buildGeneticEvidence(diseaseName: string, targets: PathwayTarget[]): GeneticEvidenceRow[] {
  if (targets.length === 0) return [];
  const prioritized = [...targets]
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);
  const strongest = prioritized[0]?.score ?? 0;

  return [{
    disorder: diseaseName,
    source_gwas: "OpenTargets associatedTargets proxy",
    prioritized_genes: prioritized.map((target) => target.symbol),
    top_loci: prioritized.slice(0, 5).map((target, index) => ({
      snp_id: "",
      chromosome: "",
      position: 0,
      p_value: Number(Math.max(1e-20, 1 - target.score).toFixed(6)),
      mapped_gene: target.symbol,
      source_pmid: ""
    })),
    genetic_support_score: Number(Math.min(1, strongest).toFixed(3)),
    note:
      "OpenTargets disease-target association score is used here as a supportive genetic/causal proxy only; it does not establish target-level causality."
  }];
}

async function searchClinicalTrials(condition: string): Promise<ClinicalTrialRow[]> {
  const url = new URL(CLINICAL_TRIALS_URL);
  url.searchParams.set("query.cond", condition);
  url.searchParams.set("filter.overallStatus", "RECRUITING|ACTIVE_NOT_RECRUITING");
  url.searchParams.set("pageSize", "10");
  url.searchParams.set("format", "json");

  const response = await fetch(url, { signal: createTimeoutSignal() });
  if (!response.ok) return [];

  const data = (await response.json()) as {
    studies?: Array<{
      protocolSection?: {
        identificationModule?: { nctId?: string; briefTitle?: string };
        statusModule?: { overallStatus?: string };
        designModule?: { phases?: string[] };
        armsInterventionsModule?: { interventions?: Array<{ name?: string }> };
      };
    }>;
  };

  return (data.studies ?? []).map((study) => {
    const protocol = study.protocolSection ?? {};
    return {
      nct_id: String(protocol.identificationModule?.nctId ?? ""),
      title: String(protocol.identificationModule?.briefTitle ?? ""),
      phase: String(protocol.designModule?.phases?.[0] ?? ""),
      status: String(protocol.statusModule?.overallStatus ?? ""),
      drugs: (protocol.armsInterventionsModule?.interventions ?? [])
        .map((item) => String(item.name ?? ""))
        .filter(Boolean)
        .slice(0, 5)
    };
  }).filter((trial) => trial.nct_id && trial.title);
}

export async function runPathwayAnalysis(input: { query: string; disease_name?: string }): Promise<PathwayAnalysisResult> {
  const diseaseQuery = normalizeText(input.disease_name || input.query);
  const disease = await searchDisease(diseaseQuery);
  if (!disease?.id) {
    return {
      agent: "pathway",
      status: "success",
      pathways: [],
      genetic_evidence: [],
      clinical_trials: [],
      synthesis_mode: "deterministic"
    };
  }

  const targets = await getDiseaseTargets(String(disease.id));
  const pathwayHits: Array<{ target: PathwayTarget; pathwayId: string; pathwayName: string }> = [];
  const pathwayResults = await Promise.allSettled(
    targets.slice(0, 5).map(async (target) => ({
      target,
      pathways: await getTargetPathways(target.target_id)
    }))
  );
  for (const result of pathwayResults) {
    if (result.status !== "fulfilled") continue;
    for (const pathway of result.value.pathways.slice(0, 10)) {
      pathwayHits.push({
        target: result.value.target,
        pathwayId: String(pathway.pathwayId ?? ""),
        pathwayName: String(pathway.pathway ?? "")
      });
    }
  }

  const deterministicPathways = aggregatePathways(diseaseQuery, targets, pathwayHits);
  const deterministicGenetics = buildGeneticEvidence(diseaseQuery, targets);
  const deterministicTrials = await searchClinicalTrials(diseaseQuery);

  if (isPathwayLlmEnabled() && isOpenRouterConfigured()) {
    try {
      const completion = await callOpenRouterJson<{
        pathways?: PathwayRow[];
        clinical_trials?: ClinicalTrialRow[];
        genetic_evidence?: GeneticEvidenceRow[];
      }>({
        model: "google/gemini-2.5-flash",
        system:
          "You are a biomedical pathway analyst. Return only strict JSON. " +
          "Use the provided OpenTargets and ClinicalTrials records to synthesize the most relevant pathways, active trials, and a cautious genetic evidence summary. " +
          "Do not invent studies, genes, or trials. Keep only active/recruiting trials. Keep GWAS/genetic language explicitly non-causal.",
        user:
          `Disease: ${diseaseQuery}\n` +
          `User query context: ${input.query}\n` +
          `Targets:\n${JSON.stringify(targets)}\n` +
          `Pathway hits:\n${JSON.stringify(pathwayHits.slice(0, 50))}\n` +
          `Deterministic genetic evidence:\n${JSON.stringify(deterministicGenetics)}\n` +
          `Clinical trials:\n${JSON.stringify(deterministicTrials)}\n` +
          'Return JSON with keys "pathways", "clinical_trials", "genetic_evidence". ' +
          "Limit pathways to 10, trials to 10, and genetics to 1 block. " +
          "Preserve ids when available and ensure relevance/genetic_support_score remain numeric."
      });

      const parsed = completion.data ?? {};
      const pathways = Array.isArray(parsed.pathways) && parsed.pathways.length > 0
        ? parsed.pathways
            .map((row) => ({
              pathway_id: String(row.pathway_id ?? ""),
              pathway_name: String(row.pathway_name ?? ""),
              related_genes: Array.isArray(row.related_genes) ? row.related_genes.map(String).filter(Boolean).slice(0, 8) : [],
              relevance: Number(row.relevance ?? 0)
            }))
            .filter((row) => row.pathway_id || row.pathway_name)
            .slice(0, 10)
        : deterministicPathways;
      const clinical_trials = Array.isArray(parsed.clinical_trials) && parsed.clinical_trials.length > 0
        ? parsed.clinical_trials
            .map((trial) => ({
              nct_id: String(trial.nct_id ?? ""),
              title: String(trial.title ?? ""),
              phase: String(trial.phase ?? ""),
              status: String(trial.status ?? ""),
              drugs: Array.isArray(trial.drugs) ? trial.drugs.map(String).filter(Boolean).slice(0, 5) : []
            }))
            .filter((trial) => trial.nct_id && trial.title)
            .slice(0, 10)
        : deterministicTrials;
      const genetic_evidence = Array.isArray(parsed.genetic_evidence) && parsed.genetic_evidence.length > 0
        ? parsed.genetic_evidence
            .map((row) => ({
              disorder: String(row.disorder ?? diseaseQuery),
              source_gwas: String(row.source_gwas ?? ""),
              prioritized_genes: Array.isArray(row.prioritized_genes) ? row.prioritized_genes.map(String).filter(Boolean).slice(0, 10) : [],
              top_loci: Array.isArray(row.top_loci)
                ? row.top_loci.slice(0, 5).map((locus) => ({
                    snp_id: String(locus?.snp_id ?? ""),
                    chromosome: String(locus?.chromosome ?? ""),
                    position: Number(locus?.position ?? 0),
                    p_value: Number(locus?.p_value ?? 1),
                    mapped_gene: String(locus?.mapped_gene ?? ""),
                    source_pmid: String(locus?.source_pmid ?? "")
                  }))
                : [],
              genetic_support_score: Number(row.genetic_support_score ?? 0),
              note: String(row.note ?? "")
            }))
            .slice(0, 1)
        : deterministicGenetics;

      return {
        agent: "pathway",
        status: "success",
        pathways,
        genetic_evidence,
        clinical_trials,
        model_used: completion.model,
        synthesis_mode: "llm"
      };
    } catch {
      // Fall back to deterministic aggregation if the model is unavailable.
    }
  }

  return {
    agent: "pathway",
    status: "success",
    pathways: deterministicPathways,
    genetic_evidence: deterministicGenetics,
    clinical_trials: deterministicTrials,
    synthesis_mode: "deterministic"
  };
}
