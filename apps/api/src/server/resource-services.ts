const PUBMED_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const OPENALEX_BASE = "https://api.openalex.org";
const CHEMBL_BASE = "https://www.ebi.ac.uk/chembl/api/data";
const OPENTARGETS_URL = "https://api.platform.opentargets.org/api/v4/graphql";
const REQUIRED_DISCLAIMER_PHRASES = [
  "research purposes only",
  "does not constitute medical advice",
  "must be validated by qualified researchers"
] as const;

const DISEASE_ALIAS_MAP: Record<string, string[]> = {
  "fibrodysplasia ossificans progressiva": [
    "fop",
    "myositis ossificans progressiva",
    "myositis ossificans progressive"
  ]
};
const NCBI_MAX_RETRIES = 3;
const NCBI_BASE_BACKOFF_MS = 800;
const PUBMED_SEARCH_CACHE_TTL_MS = 15 * 60 * 1000;
const PUBMED_FETCH_CACHE_TTL_MS = 15 * 60 * 1000;
const OPENALEX_CACHE_TTL_MS = 30 * 60 * 1000;
const DRUGDB_FETCH_TIMEOUT_MS = 15_000;
const FULL_TEXT_SHORTLIST_LIMIT = 5;
const FULL_TEXT_SNIPPET_LIMIT = 3;
const literatureCache = new Map<string, { expiresAt: number; value: unknown }>();

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function createDrugdbTimeoutSignal(timeoutMs = DRUGDB_FETCH_TIMEOUT_MS) {
  return AbortSignal.timeout(timeoutMs);
}

function createLiteratureTimeoutSignal(timeoutMs = 12_000) {
  return AbortSignal.timeout(timeoutMs);
}

function stripParenthetical(value: string): string {
  return normalizeText(value.replace(/\([^)]*\)/g, " "));
}

function isInstructionalResearchQuery(value: string): boolean {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return false;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount < 6) return false;
  return /\b(find|identify|prioritize|screen|discover|evaluate|assess|repurposing|candidate|candidates|hypotheses|mechanistic|overlap|human evidence|clinical exposure)\b/i.test(normalized);
}

function extractDiseasePhraseFromQuery(query: string): string {
  const normalized = stripParenthetical(query);
  if (!normalized) return "";
  const match =
    normalized.match(/\bfor\s+(.+?)(?:\s+(?:with|using|based on|by|via|through|that|and prioritizing)\b|$)/i) ||
    normalized.match(/\bin\s+(.+?)(?:\s+(?:with|using|based on|by|via|through|that|and prioritizing)\b|$)/i);
  return normalizeText(match?.[1] ?? "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canonicalizeDiseaseTitle(value: string): string {
  return normalizeText(
    value
      .toLowerCase()
      .replace(/\b([a-z]+)'s\b/g, "$1")
      .replace(/[.:;,/()[\]"-]+/g, " ")
  );
}

function buildDiseaseAliases(query: string, diseaseName?: string): string[] {
  const normalizedDiseaseName = normalizeText(diseaseName ?? "");
  const normalizedQuery = normalizeText(query);
  const extractedDiseaseFromQuery = !normalizedDiseaseName && isInstructionalResearchQuery(normalizedQuery)
    ? extractDiseasePhraseFromQuery(normalizedQuery)
    : "";
  const seeds = [
    normalizedDiseaseName,
    extractedDiseaseFromQuery,
    normalizedDiseaseName && isInstructionalResearchQuery(normalizedQuery) ? "" : normalizedQuery
  ].filter(Boolean);
  const aliases = new Set<string>();

  for (const seed of seeds) {
    aliases.add(seed);
    aliases.add(stripParenthetical(seed));
    const matches = [...seed.matchAll(/\(([^)]+)\)/g)];
    for (const match of matches) {
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

  return [...aliases].map((value) => normalizeText(value)).filter(Boolean);
}

function textMentionsAlias(text: string, alias: string): boolean {
  const normalizedText = normalizeText(text).toLowerCase();
  const normalizedAlias = normalizeText(alias).toLowerCase();
  if (!normalizedText || !normalizedAlias) return false;
  if (normalizedAlias.length <= 6) {
    return new RegExp(`\\b${escapeRegExp(normalizedAlias)}\\b`, "i").test(normalizedText);
  }
  return normalizedText.includes(normalizedAlias);
}

function buildDiseaseTerms(aliases: string[]): string[] {
  return [...new Set(
    aliases
      .flatMap((alias) => normalizeText(alias).toLowerCase().split(/[^a-z0-9]+/i))
      .filter((term) => term.length >= 4)
      .filter((term) => ![
        "disease",
        "syndrome",
        "disorder",
        "ataxia",
        "neuropathy",
        "dystonia",
        "parkinsonism",
        "dementia",
        "epilepsy",
        "myopathy",
        "progressive",
        "progressiva",
        "progression",
        "type",
        "patient",
        "patients"
      ].includes(term))
  )];
}

function titleLooksGeneric(title: string, aliases: string[]): boolean {
  const normalizedTitle = normalizeText(title).toLowerCase().replace(/[.:;]+$/g, "");
  if (!normalizedTitle) return false;
  if (aliases.some((alias) => textMentionsAlias(normalizedTitle, alias))) return false;
  const genericTitles = new Set([
    "ataxia",
    "dystonia",
    "epilepsy",
    "neuropathy",
    "parkinsonism",
    "dementia",
    "myopathy",
    "autism",
    "migraine"
  ]);
  if (genericTitles.has(normalizedTitle)) return true;
  const titleTerms = normalizedTitle.split(/[^a-z0-9]+/i).filter(Boolean);
  if (titleTerms.length <= 2) return true;
  return false;
}

function buildLiteratureSnippetTerms(query: string, diseaseName?: string): string[] {
  return [...new Set(
    buildDiseaseAliases(query, diseaseName)
      .flatMap((alias) => normalizeText(alias).toLowerCase().split(/[^a-z0-9]+/i))
      .filter((term) => term.length >= 4)
  )];
}

function cleanSnippetText(value: string): string {
  return normalizeText(
    value
      .replace(/\[[^\]]+\]/g, " ")
      .replace(/\(\s*\)/g, " ")
      .replace(/\s+/g, " ")
  );
}

function selectFullTextSnippets(input: {
  passages: Array<{ text: string; section: string }>;
  query: string;
  diseaseName?: string;
}): string[] {
  const diseaseTerms = buildLiteratureSnippetTerms(input.query, input.diseaseName);
  const preferredSections = ["result", "discussion", "conclusion", "abstract", "case", "finding"];

  const ranked = input.passages
    .map((passage) => {
      const text = cleanSnippetText(passage.text);
      if (text.length < 120) return null;
      const lowered = text.toLowerCase();
      const section = passage.section.toLowerCase();
      const diseaseHits = diseaseTerms.filter((term) => lowered.includes(term)).length;
      const sectionBonus = preferredSections.some((label) => section.includes(label)) ? 3 : 0;
      return {
        text,
        score: diseaseHits * 2 + sectionBonus + Math.min(2, Math.floor(text.length / 400))
      };
    })
    .filter(Boolean) as Array<{ text: string; score: number }>;

  return ranked
    .sort((left, right) => right.score - left.score || right.text.length - left.text.length)
    .slice(0, FULL_TEXT_SNIPPET_LIMIT)
    .map((item) => item.text);
}

async function enrichShortlistedFullText(input: {
  papers: Array<{
    pmid: string;
    title: string;
    abstract: string;
    journal: string;
    year: number;
    publication_types: string[];
    mesh_headings: string[];
  }>;
  query: string;
  disease_name?: string;
}) {
  const enriched = await Promise.all(
    input.papers.map(async (paper, index) => {
      if (!paper.pmid || index >= FULL_TEXT_SHORTLIST_LIMIT) {
        return {
          ...paper,
          content_level: "abstract" as const,
          evidence_snippets: [] as string[],
          source_url: paper.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/` : ""
        };
      }

      try {
        const response = await fetch(
          `https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_json/${encodeURIComponent(paper.pmid)}/unicode`,
          { signal: createLiteratureTimeoutSignal() }
        );
        if (!response.ok) {
          return {
            ...paper,
            content_level: "abstract" as const,
            evidence_snippets: [] as string[],
            source_url: `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`
          };
        }

        const bioc = (await response.json()) as {
          documents?: Array<{
            id?: string;
            infons?: Record<string, unknown>;
            passages?: Array<{
              text?: string;
              infons?: Record<string, unknown>;
            }>;
          }>;
        };

        const doc = bioc.documents?.[0];
        const passages = (doc?.passages ?? [])
          .map((passage) => ({
            text: String(passage.text ?? "").trim(),
            section: String(
              passage.infons?.section_type ??
              passage.infons?.section ??
              passage.infons?.type ??
              ""
            ).trim()
          }))
          .filter((passage) => passage.text);

        const evidenceSnippets = selectFullTextSnippets({
          passages,
          query: input.query,
          diseaseName: input.disease_name
        });

        const docId = String(doc?.id ?? "");
        const pmcidMatch = docId.match(/PMC\d+/i);
        const pmcid = pmcidMatch?.[0]?.toUpperCase() ?? "";

        return {
          ...paper,
          content_level: evidenceSnippets.length > 0 ? "full_text" as const : "abstract" as const,
          evidence_snippets: evidenceSnippets,
          source_url: pmcid
            ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`
            : `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`
        };
      } catch {
        return {
          ...paper,
          content_level: "abstract" as const,
          evidence_snippets: [] as string[],
          source_url: `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`
        };
      }
    })
  );

  return enriched;
}

function articleRichnessScore(input: {
  title: string;
  abstract: string;
  publicationTypes?: string[];
  meshHeadings?: string[];
}): number {
  let score = 0;
  const normalizedTitle = normalizeText(input.title);
  const normalizedAbstract = normalizeText(input.abstract);
  const publicationTypes = input.publicationTypes ?? [];
  const meshHeadings = input.meshHeadings ?? [];

  const titleTerms = normalizedTitle.split(/[^a-z0-9]+/i).filter(Boolean).length;
  if (titleTerms >= 4) score += 2;
  if (normalizedAbstract.length >= 600) score += 3;
  else if (normalizedAbstract.length >= 300) score += 2;
  else if (normalizedAbstract.length >= 120) score += 1;

  if (meshHeadings.length >= 4) score += 2;
  else if (meshHeadings.length >= 2) score += 1;

  const isReview = publicationTypes.some((type) => /review/i.test(type));
  const hasJournalArticle = publicationTypes.some((type) => /journal article/i.test(type));
  if (isReview && hasJournalArticle) score += 1;

  return score;
}

function articleFreshnessScore(year: number): number {
  if (year >= 2023) return 6;
  if (year >= 2019) return 4;
  if (year >= 2014) return 3;
  if (year >= 2008) return 1;
  return 0;
}

function exactDiseaseTitlePenalty(input: {
  title: string;
  aliases: string[];
  year: number;
  publicationTypes?: string[];
}): number {
  const normalizedTitle = canonicalizeDiseaseTitle(input.title);
  const publicationTypes = input.publicationTypes ?? [];
  const isExactDiseaseTitle = input.aliases.some(
    (alias) => normalizedTitle === canonicalizeDiseaseTitle(alias)
  );
  if (!isExactDiseaseTitle) return 0;
  const isReview = publicationTypes.some((type) => /review/i.test(type));
  if (!isReview) return 0;
  if (input.year < 1990) return 32;
  if (input.year < 2005) return 26;
  if (input.year < 2010) return 22;
  if (input.year < 2018) return 12;
  return 0;
}

function scoreLiteratureRank(input: {
  specificity: number;
  year: number;
  citationCount: number;
  richness: number;
  exactTitlePenalty: number;
}): number {
  const citationBonus = Math.min(3, Math.floor(input.citationCount / 50));
  const exactTitleSpecificityCompression = Math.min(12, Math.floor(input.exactTitlePenalty / 2));
  return (
    input.specificity * 3 +
    articleFreshnessScore(input.year) +
    input.richness +
    citationBonus -
    input.exactTitlePenalty -
    exactTitleSpecificityCompression
  );
}

function scorePreliminaryLiteratureRank(input: {
  specificity: number;
  year: number;
  richness: number;
  exactTitlePenalty: number;
}): number {
  const exactTitleSpecificityCompression = Math.min(12, Math.floor(input.exactTitlePenalty / 2));
  return (
    input.specificity * 3 +
    articleFreshnessScore(input.year) +
    input.richness -
    input.exactTitlePenalty -
    exactTitleSpecificityCompression
  );
}

function isExactDiseaseTitle(title: string, aliases: string[]): boolean {
  const normalizedTitle = canonicalizeDiseaseTitle(title);
  return aliases.some(
    (alias) => normalizedTitle === canonicalizeDiseaseTitle(alias)
  );
}

function diversifyDiseaseTitleClusters<T extends {
  article: { title: string; year: number };
  specificity: number;
  richness: number;
  exactTitlePenalty: number;
}>(entries: T[], aliases: string[]): T[] {
  const exactTitleEntries = entries
    .filter((entry) => isExactDiseaseTitle(entry.article.title, aliases))
    .sort((left, right) =>
      scorePreliminaryLiteratureRank({
        specificity: right.specificity,
        year: right.article.year,
        richness: right.richness,
        exactTitlePenalty: right.exactTitlePenalty
      }) -
        scorePreliminaryLiteratureRank({
          specificity: left.specificity,
          year: left.article.year,
          richness: left.richness,
          exactTitlePenalty: left.exactTitlePenalty
        }) ||
      right.article.year - left.article.year
    );

  const keptExactTitlePmids = new Set(
    exactTitleEntries
      .slice(0, 2)
      .map((entry) => `${normalizeText(entry.article.title).toLowerCase()}::${entry.article.year}`)
  );

  return entries.filter((entry) => {
    if (!isExactDiseaseTitle(entry.article.title, aliases)) return true;
    const key = `${normalizeText(entry.article.title).toLowerCase()}::${entry.article.year}`;
    return keptExactTitlePmids.has(key);
  });
}

function isGenericNonDiseaseArticle(article: {
  title: string;
  mesh_headings?: string[];
}, aliases: string[]): boolean {
  if (!titleLooksGeneric(article.title, aliases)) return false;
  const meshText = (article.mesh_headings ?? []).join(" ").toLowerCase();
  return !aliases.some((alias) => textMentionsAlias(meshText, alias));
}

function isGenericDiseaseUmbrellaTitle(title: string, aliases: string[]): boolean {
  const normalizedTitle = normalizeText(title).toLowerCase().replace(/[.:;]+$/g, "");
  if (!normalizedTitle) return false;
  if (aliases.some((alias) => textMentionsAlias(normalizedTitle, alias))) return false;

  const umbrellaTitles = new Set([
    "ataxia",
    "ataxias",
    "hereditary ataxias",
    "spinocerebellar ataxia",
    "spinocerebellar ataxias",
    "neuropathy",
    "neuropathies",
    "peripheral neuropathy",
    "peripheral neuropathies",
    "dystonia",
    "dystonias",
    "epilepsy",
    "epilepsies",
    "myopathy",
    "myopathies",
    "parkinsonism",
    "dementia",
    "dementias"
  ]);

  if (umbrellaTitles.has(normalizedTitle)) return true;

  const titleTerms = normalizedTitle.split(/[^a-z0-9]+/i).filter(Boolean);
  if (
    titleTerms.length <= 3 &&
    titleTerms.every((term) =>
      [
        "ataxia",
        "ataxias",
        "hereditary",
        "neuropathy",
        "neuropathies",
        "peripheral",
        "dystonia",
        "dystonias",
        "epilepsy",
        "epilepsies",
        "myopathy",
        "myopathies",
        "parkinsonism",
        "dementia",
        "dementias"
      ].includes(term)
    )
  ) {
    return true;
  }

  return false;
}

function scoreDiseaseSpecificity(input: {
  title: string;
  abstract: string;
  aliases: string[];
  meshHeadings?: string[];
  publicationTypes?: string[];
}): number {
  let score = 0;
  const normalizedTitle = normalizeText(input.title);
  const normalizedAbstract = normalizeText(input.abstract);
  const meshText = input.meshHeadings?.join(" ") ?? "";
  const publicationTypes = input.publicationTypes ?? [];
  const diseaseTerms = buildDiseaseTerms(input.aliases);

  for (const alias of input.aliases) {
    const normalizedAlias = normalizeText(alias);
    if (!normalizedAlias) continue;
    if (textMentionsAlias(normalizedTitle, normalizedAlias)) score += 8;
    if (textMentionsAlias(normalizedAbstract, normalizedAlias)) score += 3;
    if (textMentionsAlias(meshText, normalizedAlias)) score += 5;
    if (normalizeText(normalizedTitle).toLowerCase() === normalizedAlias.toLowerCase()) score += 1;
    if (normalizeText(normalizedTitle).toLowerCase() === `${normalizedAlias.toLowerCase()}.`) score += 1;
  }

  const titleLower = normalizedTitle.toLowerCase();
  const abstractLower = normalizedAbstract.toLowerCase();
  const titleDiseaseTermMatches = diseaseTerms.filter((term) => titleLower.includes(term)).length;
  const abstractDiseaseTermMatches = diseaseTerms.filter((term) => abstractLower.includes(term)).length;
  score += Math.min(titleDiseaseTermMatches, 3) * 2;
  score += Math.min(abstractDiseaseTermMatches, 4);

  const hasDiseaseMesh = diseaseTerms.some((term) => meshText.toLowerCase().includes(term));
  if (hasDiseaseMesh) score += 4;

  const isReview = publicationTypes.some((type) => /review/i.test(type));
  if (isReview && titleLooksGeneric(normalizedTitle, input.aliases)) score -= 4;
  if (titleLooksGeneric(normalizedTitle, input.aliases)) score -= 6;
  if (titleLooksGeneric(normalizedTitle, input.aliases) && !hasDiseaseMesh) score = 0;

  return Math.max(score, 0);
}

function scoreDiseaseCentrality(input: {
  title: string;
  abstract: string;
  aliases: string[];
  meshHeadings?: string[];
  publicationTypes?: string[];
}): number {
  let score = 0;
  const normalizedTitle = normalizeText(input.title);
  const normalizedAbstract = normalizeText(input.abstract);
  const meshText = normalizeText((input.meshHeadings ?? []).join(" "));
  const titleLower = normalizedTitle.toLowerCase();
  const abstractLower = normalizedAbstract.toLowerCase();
  const meshLower = meshText.toLowerCase();
  const publicationTypes = input.publicationTypes ?? [];
  const diseaseTerms = buildDiseaseTerms(input.aliases);

  const titleAliasHits = input.aliases.filter((alias) => textMentionsAlias(normalizedTitle, alias)).length;
  const abstractAliasHits = input.aliases.filter((alias) => textMentionsAlias(normalizedAbstract, alias)).length;
  const meshAliasHits = input.aliases.filter((alias) => textMentionsAlias(meshText, alias)).length;
  const exactDiseaseTitle = isExactDiseaseTitle(normalizedTitle, input.aliases);
  const genericUmbrellaTitle = isGenericDiseaseUmbrellaTitle(normalizedTitle, input.aliases);

  score += Math.min(titleAliasHits, 2) * 12;
  score += Math.min(abstractAliasHits, 2) * 4;
  score += Math.min(meshAliasHits, 2) * 7;
  if (exactDiseaseTitle) score += 3;

  const titleDiseaseTermMatches = diseaseTerms.filter((term) => titleLower.includes(term)).length;
  const abstractDiseaseTermMatches = diseaseTerms.filter((term) => abstractLower.includes(term)).length;
  const meshDiseaseTermMatches = diseaseTerms.filter((term) => meshLower.includes(term)).length;
  score += Math.min(titleDiseaseTermMatches, 3) * 3;
  score += Math.min(abstractDiseaseTermMatches, 2) * 2;
  score += Math.min(meshDiseaseTermMatches, 2) * 2;

  const isReview = publicationTypes.some((type) => /review/i.test(type));
  if (isReview && titleAliasHits > 0) score += 2;
  if (normalizedAbstract.length >= 200 && (titleAliasHits > 0 || meshAliasHits > 0)) score += 1;
  if (genericUmbrellaTitle) score -= 14;
  if (genericUmbrellaTitle && titleAliasHits === 0 && meshAliasHits === 0) score -= 8;

  return Math.max(score, 0);
}

function passesDiseaseCentralityGate(input: {
  title: string;
  aliases: string[];
  specificity: number;
  centrality: number;
  meshHeadings?: string[];
}): boolean {
  if (input.centrality >= 12) return true;
  if (input.centrality >= 8 && input.specificity >= 10) return true;
  if (isExactDiseaseTitle(input.title, input.aliases) && input.centrality >= 8) return true;

  const meshText = normalizeText((input.meshHeadings ?? []).join(" "));
  const hasAliasMeshAnchor = input.aliases.some((alias) => textMentionsAlias(meshText, alias));
  if (hasAliasMeshAnchor && input.centrality >= 7 && input.specificity >= 8) return true;

  return false;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#xa0;/gi, " ");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function hasMethodologyRubric(text: string): boolean {
  return /100[\s-]*point(?:\s+\w+){0,3}\s+rubric/i.test(text);
}

function hasMethodologyLimitations(text: string): boolean {
  return /\bkey\s+limitations\s*:|\blimitations\s*:/i.test(text);
}

function isAgentCacheDisabled(): boolean {
  const value = process.env.BIOMED_DISABLE_AGENT_CACHE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function isAgentCacheLoggingEnabled(): boolean {
  const value = process.env.BIOMED_LOG_AGENT_CACHE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function logAgentCache(message: string) {
  if (!isAgentCacheLoggingEnabled()) return;
  console.info(`[literature-cache] ${message}`);
}

function isLiteratureDebugLoggingEnabled(): boolean {
  const value = process.env.BIOMED_LOG_LITERATURE_DEBUG?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function logLiteratureDebug(message: string) {
  if (!isLiteratureDebugLoggingEnabled()) return;
  console.info(`[literature-debug] ${message}`);
}

function shouldIncludeLiteratureDebugInResponse(): boolean {
  const value = process.env.BIOMED_INCLUDE_LITERATURE_DEBUG?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLiteratureCache<T>(key: string): T | null {
  if (isAgentCacheDisabled()) {
    logAgentCache(`bypass key=${key}`);
    return null;
  }
  const entry = literatureCache.get(key);
  if (!entry) {
    logAgentCache(`miss key=${key}`);
    return null;
  }
  if (Date.now() >= entry.expiresAt) {
    literatureCache.delete(key);
    logAgentCache(`expired key=${key}`);
    return null;
  }
  logAgentCache(`hit key=${key}`);
  return entry.value as T;
}

function writeLiteratureCache<T>(input: {
  key: string;
  ttlMs: number;
  value: T;
  shouldCache: (value: T) => boolean;
}) {
  if (isAgentCacheDisabled()) {
    logAgentCache(`skip-store-disabled key=${input.key}`);
    return;
  }
  if (!input.shouldCache(input.value)) {
    logAgentCache(`skip-store-empty key=${input.key}`);
    return;
  }
  literatureCache.set(input.key, {
    expiresAt: Date.now() + input.ttlMs,
    value: input.value
  });
  logAgentCache(`store key=${input.key} ttl_ms=${input.ttlMs}`);
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterSeconds = Number(retryAfterHeader ?? "");
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  const jitter = Math.floor(Math.random() * 250);
  return NCBI_BASE_BACKOFF_MS * 2 ** attempt + jitter;
}

async function fetchNcbiWithRetry(url: string, label: string): Promise<Response> {
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= NCBI_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, { signal: createLiteratureTimeoutSignal() });
      if (response.ok) return response;
      lastResponse = response;
      if (!shouldRetryStatus(response.status) || attempt === NCBI_MAX_RETRIES) {
        return response;
      }
      await sleep(retryDelayMs(attempt, response.headers.get("retry-after")));
    } catch (error) {
      lastError = error;
      if (attempt === NCBI_MAX_RETRIES) break;
      await sleep(retryDelayMs(attempt, null));
    }
  }

  if (lastResponse) return lastResponse;
  throw new Error(
    `${label} failed: ${lastError instanceof Error ? lastError.message : "unknown network error"}`
  );
}

function buildNcbiParams(extra: Record<string, string>) {
  const params = new URLSearchParams({
    tool: process.env.NCBI_TOOL || "biomed-research",
    email: process.env.NCBI_EMAIL || "",
    ...extra
  });

  const apiKey = process.env.NCBI_API_KEY?.trim();
  if (apiKey) params.set("api_key", apiKey);
  return params;
}

function buildLiteratureSearchTerms(query: string, diseaseName?: string): string[] {
  const aliases = buildDiseaseAliases(query, diseaseName);
  const normalizedDiseaseName = normalizeText(diseaseName ?? "");
  const extractedDiseaseFromQuery = !normalizedDiseaseName && isInstructionalResearchQuery(query)
    ? extractDiseasePhraseFromQuery(query)
    : "";
  const disease =
    normalizedDiseaseName ||
    extractedDiseaseFromQuery ||
    aliases
      .filter((alias) => alias.length > 6)
      .sort((left, right) => left.length - right.length)[0] ||
    normalizeText(query);
  const abbreviation = aliases
    .filter((alias) => alias.length > 0 && alias.length <= 10)
    .sort((left, right) => left.length - right.length)[0] || "";
  const terms = [
    `"${disease}"`,
    abbreviation ? `"${abbreviation}"` : "",
    abbreviation ? `"${abbreviation}" ${disease}`.trim() : "",
    `${disease} mechanism`.trim(),
    `${disease} biomarker`.trim(),
    `${disease} therapy`.trim(),
    `${disease} treatment`.trim(),
    disease
  ];
  return [...new Set(terms.filter(Boolean))];
}

async function searchPubmed(term: string, maxResults = 15): Promise<string[]> {
  const cacheKey = `pubmed:search:${term.toLowerCase()}::${maxResults}`;
  const cached = readLiteratureCache<string[]>(cacheKey);
  if (cached) return cached;
  const params = buildNcbiParams({
    db: "pubmed",
    term,
    retmax: String(maxResults),
    sort: "relevance",
    retmode: "json"
  });
  const response = await fetchNcbiWithRetry(`${PUBMED_BASE}/esearch.fcgi?${params.toString()}`, "PubMed search");
  if (!response.ok) throw new Error(`PubMed search failed: ${response.status}`);
  const data = (await response.json()) as {
    esearchresult?: { idlist?: string[] };
  };
  const idlist = data.esearchresult?.idlist ?? [];
  writeLiteratureCache({
    key: cacheKey,
    ttlMs: PUBMED_SEARCH_CACHE_TTL_MS,
    value: idlist,
    shouldCache: (value) => value.length > 0
  });
  return idlist;
}

async function fetchPubmed(pmids: string[]) {
  if (pmids.length === 0) return [];
  const normalizedPmids = [...new Set(pmids.map((pmid) => pmid.trim()).filter(Boolean))];
  const cacheKey = `pubmed:fetch:${normalizedPmids.sort().join(",")}`;
  const cached = readLiteratureCache<Array<{
    pmid: string;
    title: string;
    abstract: string;
    journal: string;
    year: number;
    publication_types: string[];
    mesh_headings: string[];
  }>>(cacheKey);
  if (cached) return cached;
  const params = buildNcbiParams({
    db: "pubmed",
    id: normalizedPmids.join(","),
    rettype: "abstract",
    retmode: "xml"
  });
  const response = await fetchNcbiWithRetry(`${PUBMED_BASE}/efetch.fcgi?${params.toString()}`, "PubMed fetch");
  if (!response.ok) throw new Error(`PubMed fetch failed: ${response.status}`);
  const xml = await response.text();
  const articleBlocks = xml.match(/<PubmedArticle[\s\S]*?<\/PubmedArticle>/g) ?? [];
  const parsedByPmid = new Map<string, {
    pmid: string;
    title: string;
    abstract: string;
    journal: string;
    year: number;
    publication_types: string[];
    mesh_headings: string[];
  }>();

  for (const block of articleBlocks) {
    const pmid = block.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1]?.trim() ?? "";
    if (!pmid) continue;
    const abstractParts = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)]
      .map((match) => decodeXmlText((match[1] ?? "").replace(/<[^>]+>/g, " ")).trim())
      .filter(Boolean);
    const publicationTypes = [...block.matchAll(/<PublicationType[^>]*>([\s\S]*?)<\/PublicationType>/g)]
      .map((match) => decodeXmlText((match[1] ?? "").replace(/<[^>]+>/g, " ")).trim())
      .filter(Boolean);
    const meshHeadings = [...block.matchAll(/<MeshHeading[\s\S]*?<DescriptorName[^>]*>([\s\S]*?)<\/DescriptorName>[\s\S]*?<\/MeshHeading>/g)]
      .map((match) => decodeXmlText((match[1] ?? "").replace(/<[^>]+>/g, " ")).trim())
      .filter(Boolean);
    parsedByPmid.set(pmid, {
      pmid,
      title: decodeXmlText((block.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/)?.[1] ?? "").replace(/<[^>]+>/g, " ")).trim(),
      abstract: abstractParts.join(" ").trim(),
      journal: decodeXmlText((block.match(/<Journal>[\s\S]*?<Title>([\s\S]*?)<\/Title>/)?.[1] ?? "").replace(/<[^>]+>/g, " ")).trim(),
      year: Number(block.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/)?.[1] ?? 0),
      publication_types: publicationTypes,
      mesh_headings: meshHeadings
    });
  }

  const articles = normalizedPmids.map((pmid) => parsedByPmid.get(pmid) ?? {
    pmid,
    title: "",
    abstract: "",
    journal: "",
    year: 0,
    publication_types: [],
    mesh_headings: []
  });
  writeLiteratureCache({
    key: cacheKey,
    ttlMs: PUBMED_FETCH_CACHE_TTL_MS,
    value: articles,
    shouldCache: (value) => value.some((article) => Boolean(article.title || article.abstract))
  });
  return articles;
}

async function enrichOpenAlex(pmids: string[]) {
  if (pmids.length === 0) return {};
  const normalizedPmids = [...new Set(pmids.map((pmid) => pmid.trim()).filter(Boolean))].slice(0, 20);
  const cacheKey = `openalex:${normalizedPmids.slice().sort().join(",")}`;
  const cached = readLiteratureCache<Record<string, {
    openalex_id: string | null;
    cited_by_count: number;
    doi: string;
    publisher: string;
  }>>(cacheKey);
  if (cached) return cached;
  const filter = normalizedPmids.map((pmid) => `pmid:${pmid}`).join("|");
  const params = new URLSearchParams({ filter, per_page: "20" });
  const email = process.env.OPENALEX_EMAIL?.trim();
  if (email) params.set("mailto", email);

  const response = await fetch(`${OPENALEX_BASE}/works?${params.toString()}`, {
    signal: createLiteratureTimeoutSignal()
  });
  if (!response.ok) return {};

  const data = (await response.json()) as {
    results?: Array<{
      id?: string;
      cited_by_count?: number;
      ids?: { pmid?: string; doi?: string };
      primary_location?: { source?: { host_organization_name?: string } };
    }>;
  };

  const enriched = Object.fromEntries(
    (data.results ?? []).flatMap((work) => {
      const rawPmid = work.ids?.pmid?.replace("https://pubmed.ncbi.nlm.nih.gov/", "").replace(/\/$/, "");
      if (!rawPmid) return [];
      return [[rawPmid, {
        openalex_id: work.id ?? null,
        cited_by_count: work.cited_by_count ?? 0,
        doi: work.ids?.doi?.replace("https://doi.org/", "") ?? "",
        publisher: work.primary_location?.source?.host_organization_name ?? ""
      }]];
    })
  );
  writeLiteratureCache({
    key: cacheKey,
    ttlMs: OPENALEX_CACHE_TTL_MS,
    value: enriched,
    shouldCache: (value) => Object.keys(value).length > 0
  });
  return enriched;
}

export async function runLiteratureSearchService(input: { query: string; disease_name?: string }) {
  const searchTerms = buildLiteratureSearchTerms(input.query, input.disease_name);
  const aliases = buildDiseaseAliases(input.query, input.disease_name);
  let matchedQuery = "";
  const pmidSet = new Set<string>();

  for (const term of searchTerms) {
    const results = await searchPubmed(term, 15);
    if (!matchedQuery && results.length > 0) matchedQuery = term;
    for (const pmid of results) {
      if (pmidSet.size >= 18) break;
      pmidSet.add(pmid);
    }
    if (pmidSet.size >= 18) break;
    if (pmidSet.size >= 12 && term === matchedQuery) break;
  }

  const fetchedPmids = [...pmidSet];
  const articles = await fetchPubmed(fetchedPmids);
  const rankedArticles = articles
    .map((article) => ({
      article,
      specificity: scoreDiseaseSpecificity({
        title: article.title,
        abstract: article.abstract,
        aliases,
        meshHeadings: article.mesh_headings,
        publicationTypes: article.publication_types
      }),
      centrality: scoreDiseaseCentrality({
        title: article.title,
        abstract: article.abstract,
        aliases,
        meshHeadings: article.mesh_headings,
        publicationTypes: article.publication_types
      }),
      richness: articleRichnessScore({
        title: article.title,
        abstract: article.abstract,
        publicationTypes: article.publication_types,
        meshHeadings: article.mesh_headings
      }),
      exactTitlePenalty: exactDiseaseTitlePenalty({
        title: article.title,
        aliases,
        year: article.year,
        publicationTypes: article.publication_types
      })
    }))
    .sort((left, right) =>
      scorePreliminaryLiteratureRank({
        specificity: right.specificity,
        year: right.article.year,
        richness: right.richness,
        exactTitlePenalty: right.exactTitlePenalty
      }) -
        scorePreliminaryLiteratureRank({
          specificity: left.specificity,
          year: left.article.year,
        richness: left.richness,
        exactTitlePenalty: left.exactTitlePenalty
      }) ||
      right.centrality - left.centrality ||
      right.article.year - left.article.year
    );
  const diversifiedArticles = diversifyDiseaseTitleClusters(rankedArticles, aliases);
  const centralityQualifiedArticles = diversifiedArticles.filter((entry) =>
    passesDiseaseCentralityGate({
      title: entry.article.title,
      aliases,
      specificity: entry.specificity,
      centrality: entry.centrality,
      meshHeadings: entry.article.mesh_headings
    })
  );
  const diseaseSpecificArticles = diversifiedArticles.filter((entry) => entry.specificity > 0);
  const preliminaryPool =
    centralityQualifiedArticles.length > 0
      ? centralityQualifiedArticles
      : diseaseSpecificArticles.length > 0
        ? diseaseSpecificArticles
        : diversifiedArticles;

  for (const entry of rankedArticles) {
    const passesCentrality = passesDiseaseCentralityGate({
      title: entry.article.title,
      aliases,
      specificity: entry.specificity,
      centrality: entry.centrality,
      meshHeadings: entry.article.mesh_headings
    });
    logLiteratureDebug(
      `pmid=${entry.article.pmid || "na"} year=${entry.article.year || 0} specificity=${entry.specificity} centrality=${entry.centrality} richness=${entry.richness} exactPenalty=${entry.exactTitlePenalty} passesCentrality=${passesCentrality} umbrellaTitle=${isGenericDiseaseUmbrellaTitle(entry.article.title, aliases)} title="${normalizeText(entry.article.title)}"`
    );
  }

  const preliminarySelection = preliminaryPool.slice(0, 10);
  const pmids = preliminarySelection.map((entry) => entry.article.pmid);
  const openalex = await enrichOpenAlex(pmids);
  const selectedArticles = preliminarySelection
    .slice()
    .sort((left, right) =>
      scoreLiteratureRank({
        specificity: right.specificity,
        year: right.article.year,
        citationCount: openalex[right.article.pmid]?.cited_by_count ?? 0,
        richness: right.richness,
        exactTitlePenalty: right.exactTitlePenalty
      }) -
        scoreLiteratureRank({
          specificity: left.specificity,
          year: left.article.year,
          citationCount: openalex[left.article.pmid]?.cited_by_count ?? 0,
          richness: left.richness,
          exactTitlePenalty: left.exactTitlePenalty
        }) ||
      right.centrality - left.centrality ||
      right.article.year - left.article.year
    )
    .filter((entry) =>
      passesDiseaseCentralityGate({
        title: entry.article.title,
        aliases,
        specificity: entry.specificity,
        centrality: entry.centrality,
        meshHeadings: entry.article.mesh_headings
      })
    )
    .filter((entry) => !isGenericNonDiseaseArticle(entry.article, aliases))
    .filter((entry) => !isGenericDiseaseUmbrellaTitle(entry.article.title, aliases))
    .map((entry) => entry.article);
  const finalPassedCentralityCount = preliminarySelection.filter((entry) =>
    passesDiseaseCentralityGate({
      title: entry.article.title,
      aliases,
      specificity: entry.specificity,
      centrality: entry.centrality,
      meshHeadings: entry.article.mesh_headings
    })
  ).length;
  const finalGenericNonDiseaseExcludedCount = preliminarySelection.filter((entry) =>
    isGenericNonDiseaseArticle(entry.article, aliases)
  ).length;
  const finalUmbrellaExcludedCount = preliminarySelection.filter((entry) =>
    isGenericDiseaseUmbrellaTitle(entry.article.title, aliases)
  ).length;
  const enrichedArticles = await enrichShortlistedFullText({
    papers: selectedArticles,
    query: input.query,
    disease_name: input.disease_name
  });
  const includeDebug = shouldIncludeLiteratureDebugInResponse();
  const debugEntries = includeDebug
    ? rankedArticles.map((entry) => {
        const passedCentralityGate = passesDiseaseCentralityGate({
          title: entry.article.title,
          aliases,
          specificity: entry.specificity,
          centrality: entry.centrality,
          meshHeadings: entry.article.mesh_headings
        });
        const excludedAsGenericNonDisease = isGenericNonDiseaseArticle(entry.article, aliases);
        const excludedAsUmbrellaTitle = isGenericDiseaseUmbrellaTitle(entry.article.title, aliases);
        const includedInPreliminarySelection = preliminarySelection.some(
          (selectedEntry) => selectedEntry.article.pmid === entry.article.pmid
        );
        const includedInFinalSelection = selectedArticles.some((article) => article.pmid === entry.article.pmid);

        let finalExcludedReason = "";
        if (!passedCentralityGate) finalExcludedReason = "failed_centrality_gate";
        else if (excludedAsGenericNonDisease) finalExcludedReason = "generic_non_disease_article";
        else if (excludedAsUmbrellaTitle) finalExcludedReason = "generic_umbrella_title";
        else if (!includedInPreliminarySelection) finalExcludedReason = "below_preliminary_cutoff";
        else if (!includedInFinalSelection) finalExcludedReason = "filtered_after_rerank";

        return {
          pmid: entry.article.pmid,
          title: entry.article.title,
          year: entry.article.year,
          specificity: entry.specificity,
          centrality: entry.centrality,
          richness: entry.richness,
          exact_title_penalty: entry.exactTitlePenalty,
          citation_count: openalex[entry.article.pmid]?.cited_by_count ?? 0,
          preliminary_rank_score: scorePreliminaryLiteratureRank({
            specificity: entry.specificity,
            year: entry.article.year,
            richness: entry.richness,
            exactTitlePenalty: entry.exactTitlePenalty
          }),
          final_rank_score: scoreLiteratureRank({
            specificity: entry.specificity,
            year: entry.article.year,
            citationCount: openalex[entry.article.pmid]?.cited_by_count ?? 0,
            richness: entry.richness,
            exactTitlePenalty: entry.exactTitlePenalty
          }),
          passed_centrality_gate: passedCentralityGate,
          umbrella_title: excludedAsUmbrellaTitle,
          generic_non_disease_article: excludedAsGenericNonDisease,
          included_in_preliminary_selection: includedInPreliminarySelection,
          included_in_final_selection: includedInFinalSelection,
          final_excluded_reason: finalExcludedReason
        };
      })
    : undefined;

  return {
    request_id: crypto.randomUUID(),
    disease_name: input.disease_name ?? input.query,
    query: input.query,
    matched_query: matchedQuery,
    search_terms: searchTerms,
    pmids,
    retrieval_stats: {
      retrieved_count: fetchedPmids.length,
      disease_specific_count: diseaseSpecificArticles.length,
      centrality_qualified_count: centralityQualifiedArticles.length,
      preliminary_selection_count: preliminarySelection.length,
      final_shortlist_count: selectedArticles.length,
      excluded_by_centrality_count: Math.max(preliminarySelection.length - finalPassedCentralityCount, 0),
      excluded_as_generic_non_disease_count: finalGenericNonDiseaseExcludedCount,
      excluded_as_umbrella_title_count: finalUmbrellaExcludedCount
    },
    papers: enrichedArticles.map((article) => ({
      ...article,
      doi: openalex[article.pmid]?.doi ?? "",
      publisher: openalex[article.pmid]?.publisher ?? "",
      publication_type: article.publication_types[0] ?? "",
      publication_types: article.publication_types,
      mesh_headings: article.mesh_headings,
      retraction_flag: false,
      concern_flag: false,
      correction_flag: false,
      guideline_citation_flag: false,
      citation_count: openalex[article.pmid]?.cited_by_count ?? 0,
      openalex_id: openalex[article.pmid]?.openalex_id ?? null
    })),
    total_found: selectedArticles.length,
    ...(includeDebug ? { debug: { literature_ranking: debugEntries } } : {})
  };
}

async function chemblTargetSearch(query: string) {
  const url = new URL(`${CHEMBL_BASE}/target/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  url.searchParams.set("offset", "0");
  url.searchParams.set("format", "json");
  const response = await fetch(url, { signal: createDrugdbTimeoutSignal() });
  if (!response.ok) {
    throw new Error(
      response.status >= 500
        ? `DrugDB target lookup failed because ChEMBL returned ${response.status}.`
        : `DrugDB target lookup failed because ChEMBL returned ${response.status}.`
    );
  }
  const data = (await response.json()) as { targets?: Array<Record<string, unknown>> };
  return data.targets ?? [];
}

function summarizeChemblLookupFailure(error: unknown): string {
  const text = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
  const lowered = text.toLowerCase();

  if (lowered.includes("returned 500")) {
    return "ChEMBL target lookup is temporarily unavailable because the upstream service returned 500.";
  }
  if (lowered.includes("returned 400")) {
    return "ChEMBL target lookup rejected the disease query format for this pass.";
  }
  if (lowered.includes("timed out") || lowered.includes("timeout") || lowered.includes("aborted")) {
    return "ChEMBL target lookup timed out before target matches were returned.";
  }
  return text || "ChEMBL target lookup failed before target matches were returned.";
}

async function chemblActivities(targetChemblId: string) {
  const url = new URL(`${CHEMBL_BASE}/activity`);
  url.searchParams.set("target_chembl_id", targetChemblId);
  url.searchParams.set("assay_type", "B");
  url.searchParams.set("limit", "20");
  url.searchParams.set("offset", "0");
  url.searchParams.set("format", "json");
  const response = await fetch(url, { signal: createDrugdbTimeoutSignal() });
  if (!response.ok) return [];
  const data = (await response.json()) as { activities?: Array<Record<string, unknown>> };
  return data.activities ?? [];
}

function bestActivityStrength(activity: Record<string, unknown>): number {
  const pchembl = asNumber(activity.pchembl_value);
  if (pchembl > 0) return pchembl;
  const standardValue = asNumber(activity.standard_value);
  if (standardValue > 0) return Math.max(0, 12 - Math.log10(standardValue));
  return 0;
}

function normalizeTargetLabel(value: string): string {
  const normalized = normalizeText(value).replace(/\s+/g, " ").trim();
  if (!normalized) return "research-targeted";
  if (/cell line/i.test(normalized)) return "research-targeted";
  return normalized;
}

function buildFallbackCompoundName(input: {
  moleculeId: string;
  targetName?: string;
  moleculeType?: string;
}) {
  const targetLabel = normalizeTargetLabel(input.targetName ?? "");
  const moleculeType = normalizeText(input.moleculeType ?? "").toLowerCase();
  const scaffoldLabel =
    moleculeType.includes("small molecule")
      ? "small molecule"
      : moleculeType.includes("antibody")
        ? "antibody"
        : "compound";
  return `Unnamed ${targetLabel} ${scaffoldLabel} (${input.moleculeId})`;
}

const pubchemNameCache = new Map<string, string | null>();

async function chemblMolecule(moleculeChemblId: string) {
  const url = new URL(`${CHEMBL_BASE}/molecule/${encodeURIComponent(moleculeChemblId)}`);
  url.searchParams.set("format", "json");
  const response = await fetch(url, { signal: createDrugdbTimeoutSignal() });
  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}

async function pubchemCompoundNameFromInchiKey(inchiKey: string) {
  const normalizedKey = String(inchiKey || "").trim().toUpperCase();
  if (!normalizedKey) return "";
  if (pubchemNameCache.has(normalizedKey)) return pubchemNameCache.get(normalizedKey) ?? "";

  const url = new URL(
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/${encodeURIComponent(normalizedKey)}/property/Title,IUPACName/JSON`
  );
  const response = await fetch(url, { signal: createDrugdbTimeoutSignal() });
  if (!response.ok) {
    pubchemNameCache.set(normalizedKey, null);
    return "";
  }

  const data = (await response.json()) as {
    PropertyTable?: {
      Properties?: Array<Record<string, unknown>>;
    };
  };
  const property = data.PropertyTable?.Properties?.[0] ?? null;
  const name = asString(property?.Title) || asString(property?.IUPACName) || "";
  pubchemNameCache.set(normalizedKey, name || null);
  return name;
}

async function chemblDrugIndications(moleculeChemblId: string) {
  const url = new URL(`${CHEMBL_BASE}/drug_indication`);
  url.searchParams.set("molecule_chembl_id", moleculeChemblId);
  url.searchParams.set("limit", "8");
  url.searchParams.set("offset", "0");
  url.searchParams.set("format", "json");
  const response = await fetch(url, { signal: createDrugdbTimeoutSignal() });
  if (!response.ok) return [];
  const data = (await response.json()) as { drug_indications?: Array<Record<string, unknown>> };
  return data.drug_indications ?? [];
}

async function openTargetsDrugs(query: string) {
  let diseaseId = "";
  for (const alias of buildDiseaseAliases(query)) {
    const diseaseSearchResponse = await fetch(OPENTARGETS_URL, {
      method: "POST",
      signal: createDrugdbTimeoutSignal(),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query SearchDisease($query: String!) { search(queryString: $query, entityNames: ["disease"], page: { index: 0, size: 3 }) { hits { id name } } }`,
        variables: { query: alias }
      })
    });
    if (!diseaseSearchResponse.ok) continue;
    const diseaseSearch = (await diseaseSearchResponse.json()) as {
      data?: { search?: { hits?: Array<{ id: string }> } };
    };
    diseaseId = diseaseSearch.data?.search?.hits?.[0]?.id ?? "";
    if (diseaseId) break;
  }
  if (!diseaseId) return [];

  const targetResponse = await fetch(OPENTARGETS_URL, {
    method: "POST",
    signal: createDrugdbTimeoutSignal(),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query DiseaseTargets($diseaseId: String!) { disease(efoId: $diseaseId) { associatedTargets(page: { index: 0, size: 8 }) { rows { target { id approvedSymbol } } } } }`,
      variables: { diseaseId }
    })
  });
  if (!targetResponse.ok) return [];
  const targetData = (await targetResponse.json()) as {
    data?: {
      disease?: {
        associatedTargets?: { rows?: Array<{ target?: { id?: string; approvedSymbol?: string } }> };
      };
    };
  };
  const targets = targetData.data?.disease?.associatedTargets?.rows ?? [];

  const collected: Array<Record<string, unknown>> = [];
  const seenDrugIds = new Set<string>();
  for (const row of targets) {
    const targetId = row.target?.id;
    const targetSymbol = row.target?.approvedSymbol;
    if (!targetId) continue;
    const drugsResponse = await fetch(OPENTARGETS_URL, {
      method: "POST",
      signal: createDrugdbTimeoutSignal(),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: `query TargetDrugs($targetId: String!) { target(ensemblId: $targetId) { drugAndClinicalCandidates { rows { drug { id name maximumClinicalStage mechanismsOfAction } diseases { disease { name } } maxClinicalStage } } } }`,
        variables: { targetId }
      })
    });
    if (!drugsResponse.ok) continue;
    const drugsData = (await drugsResponse.json()) as {
      data?: { target?: { drugAndClinicalCandidates?: { rows?: Array<Record<string, unknown>> } } };
    };
    for (const candidate of (drugsData.data?.target?.drugAndClinicalCandidates?.rows ?? []).slice(0, 10)) {
      const drug = asRecord(candidate.drug);
      const drugId = asString(drug.id) || `${targetId}-${collected.length}`;
      if (seenDrugIds.has(drugId)) continue;
      seenDrugIds.add(drugId);
      collected.push({
        ...candidate,
        target_id: targetId,
        target_symbol: targetSymbol ?? ""
      });
      if (collected.length >= 40) break;
    }
    if (collected.length >= 40) break;
  }
  return collected.slice(0, 40);
}

function classifyIndicationOrigin(indications: string[]): string {
  const combined = indications.join(" ").toLowerCase();
  if (!combined) return "unknown";
  if (/(leuk|lymph|myelo|myeloma|carcin|tumou?r|oncolog|cancer)/i.test(combined)) return "oncology";
  if (/(arthritis|lupus|autoimmune|ibd|crohn|colitis|psoriasis|immun)/i.test(combined)) return "immunology";
  if (/(diabet|obes|metabolic|dyslipid)/i.test(combined)) return "metabolic";
  if (/(viral|hepatitis|infect|antimicrob|hiv)/i.test(combined)) return "infectious";
  if (/(fibrosis|als|parkinson|alzheimer|huntington|neurolog|multiple sclerosis|cns)/i.test(combined)) return "neurology";
  return "other";
}

async function buildExpandedCandidates(input: {
  diseaseName: string;
  opentargetsDrugs: Array<Record<string, unknown>>;
  activityMoleculeIds: string[];
  activityMetadata: Record<string, Record<string, unknown>>;
  maxCandidates: number;
  chemblTargets: Array<{ chembl_id: string; uniprot_id: string; protein_name: string }>;
}) {
  const candidates = new Map<string, Record<string, unknown>>();

  for (const row of input.opentargetsDrugs) {
    const drug = asRecord(row.drug);
    const moleculeId = asString(drug.id);
    const drugName = asString(drug.name) || moleculeId;
    if (!drugName) continue;
    const indications = asArray<Record<string, unknown>>(row.diseases)
      .map((item) => asString(asRecord(item.disease).name))
      .filter(Boolean)
      .slice(0, 6);
    const targetSymbol = asString(row.target_symbol);
    const maxPhase = Math.max(asNumber(row.maxClinicalStage), asNumber(drug.maxClinicalStage), asNumber(drug.maximumClinicalStage));
    const key = (moleculeId || drugName).toUpperCase();
    candidates.set(key, {
      drug_name: drugName,
      molecule_chembl_id: moleculeId,
      current_indications: indications,
      current_use: indications.length > 0 ? `Currently used or clinically studied in ${indications.join(", ")}.` : "",
      target_symbol: targetSymbol,
      mechanism:
        targetSymbol
          ? `Expanded from disease-linked target ${targetSymbol} in OpenTargets for ${input.diseaseName}.`
          : `Expanded from OpenTargets disease-target-drug associations for ${input.diseaseName}.`,
      max_phase: maxPhase,
      is_approved: maxPhase >= 4,
      source: "opentargets_expansion",
      origin_tag: classifyIndicationOrigin(indications)
    });
  }

  for (const [index, moleculeId] of input.activityMoleculeIds.slice(0, 12).entries()) {
    const molecule = await chemblMolecule(moleculeId);
    const moleculeStructures = asRecord(molecule?.molecule_structures);
    const activityMetadata = asRecord(input.activityMetadata[moleculeId]);
    const indications = (await chemblDrugIndications(moleculeId))
      .map((item) => asString(item.mesh_heading))
      .filter(Boolean)
      .slice(0, 6);
    const pubchemName = await pubchemCompoundNameFromInchiKey(asString(moleculeStructures.standard_inchi_key));
    const drugName =
      asString(molecule?.pref_name) ||
      asArray<Record<string, unknown>>(molecule?.molecule_synonyms)
        .map((item) => asString(item.molecule_synonym))
        .find(Boolean) ||
      asString(activityMetadata.molecule_pref_name) ||
      pubchemName ||
      buildFallbackCompoundName({
        moleculeId,
        targetName: asString(activityMetadata.target_pref_name) || input.chemblTargets[index % Math.max(input.chemblTargets.length, 1)]?.protein_name,
        moleculeType: asString(molecule?.molecule_type)
      });
    if (!drugName) continue;
    const key = (moleculeId || drugName).toUpperCase();
    if (candidates.has(key)) continue;
    const linkedTarget =
      asString(activityMetadata.target_pref_name) ||
      (input.chemblTargets[index % Math.max(input.chemblTargets.length, 1)]?.protein_name ??
        "");
    const maxPhase = asNumber(molecule?.max_phase);
    const hasRecoverableIdentity = Boolean(drugName && !/^CHEMBL\d+$/i.test(drugName));
    const hasUsableContext = indications.length > 0 || maxPhase > 0 || Boolean(linkedTarget);
    if (!hasRecoverableIdentity && !hasUsableContext) continue;
    candidates.set(key, {
      drug_name: drugName,
      molecule_chembl_id: moleculeId,
      current_indications: indications,
      current_use: indications.length > 0 ? `Currently used or clinically studied in ${indications.join(", ")}.` : "",
      target_symbol: linkedTarget,
      mechanism: linkedTarget
        ? `Expanded from ChEMBL activity evidence around ${linkedTarget} for ${input.diseaseName}.`
        : `Expanded from ChEMBL activity evidence relevant to ${input.diseaseName}.`,
      max_phase: maxPhase,
      is_approved: maxPhase >= 4,
      source: "chembl_activity_expansion",
      origin_tag: classifyIndicationOrigin(indications)
    });
  }

  return [...candidates.values()].slice(0, input.maxCandidates);
}

export async function runDrugdbFetchService(input: { query?: string; disease_name?: string; max_candidates?: number }) {
  const diseaseName = input.disease_name ?? input.query ?? "";
  const chemblAliases = buildDiseaseAliases(diseaseName, input.disease_name).slice(0, 4);
  if (!chemblAliases.includes(diseaseName) && diseaseName) {
    chemblAliases.unshift(diseaseName);
  }

  let rawTargets: Array<Record<string, unknown>> = [];
  let chemblDegradedReason = "";
  let chemblQueryUsed = "";
  for (const alias of chemblAliases.filter(Boolean)) {
    try {
      rawTargets = await chemblTargetSearch(alias);
      chemblQueryUsed = alias;
      if (rawTargets.length > 0) break;
    } catch (error) {
      chemblDegradedReason = summarizeChemblLookupFailure(error);
    }
  }

  const chemblTargets = rawTargets.map((target) => {
    const components = Array.isArray(target.target_components) ? target.target_components : [];
    const component = components[0] as Record<string, unknown> | undefined;
    const xrefs = Array.isArray(component?.target_component_xrefs) ? component.target_component_xrefs : [];
    const uniprot = (xrefs as Array<Record<string, unknown>>).find((xref) => xref.xref_src_db === "UniProt");
    return {
      chembl_id: String(target.target_chembl_id ?? ""),
      uniprot_id: String(uniprot?.xref_id ?? ""),
      protein_name: String(target.pref_name ?? "")
    };
  });

  const activityIds = new Set<string>();
  const activityMetadata = new Map<string, Record<string, unknown>>();
  for (const target of chemblTargets.slice(0, 3)) {
    const activities = await chemblActivities(target.chembl_id);
    for (const activity of activities) {
      const moleculeId = String(activity.molecule_chembl_id ?? "");
      if (moleculeId) {
        activityIds.add(moleculeId);
        const current = activityMetadata.get(moleculeId);
        if (!current || bestActivityStrength(activity) > bestActivityStrength(current)) {
          activityMetadata.set(moleculeId, activity);
        }
      }
      if (activityIds.size >= (input.max_candidates ?? 20)) break;
    }
  }

  const opentargets = await openTargetsDrugs(diseaseName);
  const maxCandidates = input.max_candidates ?? 20;
  const expandedCandidates = await buildExpandedCandidates({
    diseaseName,
    opentargetsDrugs: opentargets,
    activityMoleculeIds: [...activityIds].slice(0, maxCandidates),
    activityMetadata: Object.fromEntries(activityMetadata),
    maxCandidates,
    chemblTargets
  });

  return {
    request_id: crypto.randomUUID(),
    disease_name: diseaseName,
    retrieval_stats: {
      chembl_target_count: chemblTargets.length,
      chembl_status: chemblDegradedReason ? "degraded" : "ok",
      chembl_degraded_reason: chemblDegradedReason,
      chembl_query_used: chemblQueryUsed,
      opentargets_drug_count: opentargets.length,
      activity_molecule_count: [...activityIds].slice(0, maxCandidates).length,
      expanded_candidate_count: expandedCandidates.length
    },
    chembl_targets: chemblTargets,
    opentargets_drugs: opentargets,
    activity_molecule_ids: [...activityIds].slice(0, maxCandidates),
    expanded_candidates: expandedCandidates
  };
}

export async function runEvaluatorReviewService(input: {
  job_id?: string;
  reportId?: string;
  report?: Record<string, unknown>;
  evidence_scores?: Array<Record<string, unknown>>;
}) {
  const report = input.report ?? {};
  const topCandidates = Array.isArray(report.top_candidates) ? report.top_candidates : [];
  const evidenceRows = Array.isArray(report.evidence_table) ? report.evidence_table : [];
  const evidenceScores = Array.isArray(input.evidence_scores) ? input.evidence_scores : [];
  const disclaimer = asString(report.disclaimer);
  const provenance = asRecord(report.provenance);
  const methodology = asString(report.methodology);
  const summary = asString(report.summary).toLowerCase();
  const allowsNoHit =
    report.no_hit === true ||
    summary.includes("did not produce a reportable repurposing candidate");

  const safetyErrors: string[] = [];
  for (const phrase of REQUIRED_DISCLAIMER_PHRASES) {
    if (!disclaimer.toLowerCase().includes(phrase.toLowerCase())) {
      safetyErrors.push(`disclaimer_missing_phrase:${phrase}`);
    }
  }
  const pmidsUsed = Array.isArray(provenance.pmids_used) ? provenance.pmids_used : [];
  const modelsUsed = asRecord(provenance.models_used);
  if (pmidsUsed.length === 0 && !allowsNoHit) safetyErrors.push("provenance_missing:pmids_used");
  if (Object.keys(modelsUsed).length === 0) safetyErrors.push("provenance_missing:models_used");
  if (!asString(provenance.timestamp)) safetyErrors.push("provenance_missing:timestamp");

  const structureErrors: string[] = [];
  if (topCandidates.length === 0 && !allowsNoHit) structureErrors.push("report_missing:top_candidates");
  if (evidenceRows.length === 0 && !allowsNoHit) structureErrors.push("report_missing:evidence_table");
  if (!methodology) structureErrors.push("report_missing:methodology");

  const candidateErrors = topCandidates.flatMap((candidate) => {
    const item = asRecord(candidate);
    const drugName = asString(item.drug_name) || "unknown";
    const errors: string[] = [];
    if (!asString(item.mechanism_overlap)) errors.push(`top_candidate_missing_mechanism:${drugName}`);
    if (!Array.isArray(item.supporting_pmids) || item.supporting_pmids.length === 0) {
      errors.push(`top_candidate_missing_pmids:${drugName}`);
    }
    if (!asString(item.why_candidate)) errors.push(`top_candidate_missing_rationale:${drugName}`);
    if (!asString(item.main_risk) && !asString(item.false_positive_risk)) {
      errors.push(`top_candidate_missing_risk:${drugName}`);
    }
    return errors;
  });

  const evidenceRowErrors = evidenceRows.flatMap((row) => {
    const item = asRecord(row);
    const drugName = asString(item.drug_name) || "unknown";
    const summary = asString(item.summary);
    const score = asNumber(item.score);
    const errors: string[] = [];
    if (summary.length < 30) errors.push(`evidence_row_summary_short:${drugName}`);
    if (!asString(item.source)) errors.push(`evidence_row_missing_source:${drugName}`);
    if (score < 0 || score > 100) errors.push(`evidence_row_score_out_of_range:${drugName}`);
    return errors;
  });

  const evidenceScoreErrors = evidenceScores.flatMap((scoreEntry) => {
    const score = asRecord(scoreEntry);
    const breakdown = asRecord(score.breakdown);
    const drugName = asString(score.drug_name) || "unknown";
    const total = asNumber(score.score);
    const literature = asNumber(breakdown.literature_support);
    const mechanism = asNumber(breakdown.mechanism_overlap);
    const clinical = asNumber(breakdown.clinical_evidence);
    const safety = asNumber(breakdown.safety_profile);
    const genetic = asNumber(breakdown.genetic_support);
    const computed = literature + mechanism + clinical + safety + genetic;
    const errors: string[] = [];
    if (!drugName) errors.push("evidence_score_missing_drug_name");
    if (total < 0 || total > 100) errors.push(`evidence_score_out_of_range:${drugName}`);
    if (computed !== total) errors.push(`evidence_score_breakdown_mismatch:${drugName}`);
    return errors;
  });

  const topCandidateNames = new Set(
    topCandidates.map((candidate) => asString(asRecord(candidate).drug_name).toLowerCase()).filter(Boolean)
  );
  const evidenceRowNames = new Set(
    evidenceRows.map((row) => asString(asRecord(row).drug_name).toLowerCase()).filter(Boolean)
  );
  const evidenceScoreNames = new Set(
    evidenceScores.map((entry) => asString(asRecord(entry).drug_name).toLowerCase()).filter(Boolean)
  );

  const coverageErrors = [...topCandidateNames].flatMap((drugName) => {
    const errors: string[] = [];
    if (!evidenceRowNames.has(drugName)) errors.push(`candidate_missing_evidence_row:${drugName}`);
    if (!evidenceScoreNames.has(drugName)) errors.push(`candidate_missing_evidence_score:${drugName}`);
    return errors;
  });

  const methodologyErrors: string[] = [];
  if (methodology) {
    if (!hasMethodologyRubric(methodology)) methodologyErrors.push("methodology_missing:rubric");
    if (!hasMethodologyLimitations(methodology)) methodologyErrors.push("methodology_missing:limitations");
  }

  const allErrors = [
    ...safetyErrors,
    ...structureErrors,
    ...candidateErrors,
    ...evidenceRowErrors,
    ...evidenceScoreErrors,
    ...coverageErrors,
    ...methodologyErrors
  ];
  const decision = allErrors.length === 0 ? "approve" : "reject";
  const reason =
    decision === "approve"
      ? "Report passed deterministic evaluator checks for safety text, provenance, candidate structure, evidence consistency, and methodology limits."
      : `Deterministic evaluator checks failed: ${allErrors.slice(0, 8).join("; ")}`;

  return {
    job_id: input.job_id ?? input.reportId ?? "",
    decision,
    reason,
    payment_verification: {
      status: "verified_by_gateway"
    },
    reviews: {
      safety: safetyErrors.length === 0 ? "pass" : "fail",
      structure: structureErrors.length === 0 && candidateErrors.length === 0 ? "pass" : "fail",
      evidence_consistency:
        evidenceRowErrors.length === 0 && evidenceScoreErrors.length === 0 && coverageErrors.length === 0
          ? "pass"
          : "fail",
      methodology: methodologyErrors.length === 0 && Boolean(methodology) ? "pass" : "fail"
    },
    review_details: {
      safety_errors: safetyErrors,
      structure_errors: [...structureErrors, ...candidateErrors],
      evidence_errors: [...evidenceRowErrors, ...evidenceScoreErrors, ...coverageErrors],
      methodology_errors: methodologyErrors
    },
    onchain_vote: {
      status: decision === "approve" ? "deferred" : "review_reject_only"
    }
  };
}
