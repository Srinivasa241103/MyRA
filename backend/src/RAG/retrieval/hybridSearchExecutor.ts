import {
  keywordSearchRepository,
  type KeywordSearchRepository,
  type KeywordSearchResult,
} from "../../database/keywordSearchRepository.js";
import type VectorStore from "../vectorStores/vectorStore.js";
import type {
  OwnerId,
  VectorSearchFilters,
  VectorSearchResult,
} from "../vectorStores/vectorStore.js";
import type {
  PlannedVectorSearch,
  RetrievalPlan,
  RetrievalSort,
  RetrievalStrategy,
} from "./retrievalPlan.js";

export interface RetrievalRanking {
  strategy: RetrievalStrategy;
  fusion_score: number;
  vector_rank: number | null;
  keyword_rank: number | null;
  vector_distance: number | null;
  keyword_score: number | null;
  matched_terms: string[];
  rerank_score: number | null;
  rerank_rank: number | null;
}

export interface RankedSearchResult extends VectorSearchResult {
  retrieval: RetrievalRanking;
}

export interface HybridExecutionDiagnostics {
  strategy: RetrievalStrategy;
  vectorResultCount: number;
  keywordResultCount: number;
  fusedResultCount: number;
  candidateCount: number;
  degraded: boolean;
  errors: string[];
}

export interface HybridExecutionResult {
  results: RankedSearchResult[];
  diagnostics: HybridExecutionDiagnostics;
}

export interface ExecuteHybridSearchParams {
  plan: RetrievalPlan;
  vectorSearch: PlannedVectorSearch;
  userId: OwnerId;
  filters?: VectorSearchFilters;
  maxDistance?: number | null;
  getQueryEmbedding?: () => Promise<number[]>;
}

export interface HybridSearchExecutorOptions {
  rrfK?: number;
  vectorWeight?: number;
  keywordWeight?: number;
}

interface SearchDependencies {
  vectorStore: Pick<VectorStore, "search">;
  keywordRepository?: Pick<KeywordSearchRepository, "search">;
}

interface CandidateRanks {
  vectorResult?: VectorSearchResult;
  keywordResult?: KeywordSearchResult;
  vectorRank: number | null;
  keywordRank: number | null;
}

const DEFAULT_RRF_K = 60;
const DEFAULT_WEIGHT = 1;

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function candidateKey(result: VectorSearchResult): string {
  const documentId = result.document?.id ?? result.document?.source_id;
  return `${String(documentId)}:${result.chunk_index}`;
}

function deduplicate<T extends VectorSearchResult>(results: T[]): T[] {
  const seen = new Set<string>();

  return results.filter((result) => {
    const key = candidateKey(result);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function timestamp(result: VectorSearchResult): number {
  if (result.occurred_at) {
    const value = new Date(result.occurred_at).getTime();
    if (Number.isFinite(value)) return value;
  }

  const metadataTimestamp = Number(result.document?.metadata?.occurred_at_ms);
  return Number.isFinite(metadataTimestamp) ? metadataTimestamp : 0;
}

function sortResults(
  results: RankedSearchResult[],
  sort: RetrievalSort,
): RankedSearchResult[] {
  return [...results].sort((left, right) => {
    if (sort === "latest") {
      return timestamp(right) - timestamp(left) ||
        right.retrieval.fusion_score - left.retrieval.fusion_score;
    }

    if (sort === "oldest") {
      return timestamp(left) - timestamp(right) ||
        right.retrieval.fusion_score - left.retrieval.fusion_score;
    }

    return right.retrieval.fusion_score - left.retrieval.fusion_score ||
      timestamp(right) - timestamp(left);
  });
}

export class HybridSearchExecutor {
  private readonly vectorStore: Pick<VectorStore, "search">;
  private readonly keywordRepository: Pick<KeywordSearchRepository, "search">;
  private readonly rrfK: number;
  private readonly vectorWeight: number;
  private readonly keywordWeight: number;

  constructor(
    { vectorStore, keywordRepository = keywordSearchRepository }: SearchDependencies,
    options: HybridSearchExecutorOptions = {},
  ) {
    this.vectorStore = vectorStore;
    this.keywordRepository = keywordRepository;
    this.rrfK = positiveNumber(options.rrfK, DEFAULT_RRF_K);
    this.vectorWeight = positiveNumber(options.vectorWeight, DEFAULT_WEIGHT);
    this.keywordWeight = positiveNumber(options.keywordWeight, DEFAULT_WEIGHT);
  }

  private async searchVector({
    vectorSearch,
    userId,
    filters,
    maxDistance,
    getQueryEmbedding,
  }: Omit<ExecuteHybridSearchParams, "plan">): Promise<VectorSearchResult[]> {
    if (!getQueryEmbedding) {
      throw new Error("Vector retrieval requires getQueryEmbedding");
    }

    const queryEmbedding = await getQueryEmbedding();
    const results = await this.vectorStore.search({
      queryEmbedding,
      userId,
      topK: vectorSearch.topK,
      filters,
    });

    const deduplicated = deduplicate(results ?? []);
    if (maxDistance === null || maxDistance === undefined) return deduplicated;

    return deduplicated.filter((result) => result.distance <= maxDistance);
  }

  private async searchKeyword({
    plan,
    userId,
    filters,
  }: ExecuteHybridSearchParams): Promise<KeywordSearchResult[]> {
    const results = await this.keywordRepository.search({
      query: plan.contentQuery ?? "",
      userId,
      topK: plan.limits.keywordTopK,
      filters,
      sort: plan.sort,
      requireKeywordMatch: plan.contentQuery !== null,
    });

    return deduplicate(results ?? []);
  }

  private fuse(
    strategy: RetrievalStrategy,
    vectorResults: VectorSearchResult[],
    keywordResults: KeywordSearchResult[],
  ): RankedSearchResult[] {
    const candidates = new Map<string, CandidateRanks>();

    vectorResults.forEach((result, index) => {
      const key = candidateKey(result);
      const candidate = candidates.get(key) ?? {
        vectorRank: null,
        keywordRank: null,
      };

      candidate.vectorResult = result;
      candidate.vectorRank = index + 1;
      candidates.set(key, candidate);
    });

    keywordResults.forEach((result, index) => {
      const key = candidateKey(result);
      const candidate = candidates.get(key) ?? {
        vectorRank: null,
        keywordRank: null,
      };

      candidate.keywordResult = result;
      candidate.keywordRank = index + 1;
      candidates.set(key, candidate);
    });

    const maximumKeywordScore = keywordResults.reduce(
      (maximum, result) => Math.max(maximum, result.keyword_score),
      0,
    );

    return [...candidates.values()].map((candidate) => {
      const vectorScore = candidate.vectorRank === null
        ? 0
        : this.vectorWeight / (this.rrfK + candidate.vectorRank);
      const keywordScore = candidate.keywordRank === null
        ? 0
        : this.keywordWeight / (this.rrfK + candidate.keywordRank);
      const fusionScore = vectorScore + keywordScore;
      const normalizedKeywordDistance = candidate.keywordResult && maximumKeywordScore > 0
        ? 1 - candidate.keywordResult.keyword_score / maximumKeywordScore
        : 1;

      // Prefer the Postgres result when both paths found a chunk because it carries
      // the original nested document metadata expected by the context builder.
      const baseResult = candidate.keywordResult ?? candidate.vectorResult;
      if (!baseResult) {
        throw new Error("Hybrid fusion candidate did not contain a search result");
      }

      return {
        ...baseResult,
        distance: candidate.vectorResult?.distance ?? normalizedKeywordDistance,
        retrieval: {
          strategy,
          fusion_score: fusionScore,
          vector_rank: candidate.vectorRank,
          keyword_rank: candidate.keywordRank,
          vector_distance: candidate.vectorResult?.distance ?? null,
          keyword_score: candidate.keywordResult?.keyword_score ?? null,
          matched_terms: candidate.keywordResult?.matched_terms ?? [],
          rerank_score: null,
          rerank_rank: null,
        },
      };
    });
  }

  async execute(params: ExecuteHybridSearchParams): Promise<HybridExecutionResult> {
    const { plan } = params;
    const usesVector = plan.strategy === "vector" || plan.strategy === "hybrid";
    const usesKeyword = plan.strategy === "keyword" || plan.strategy === "hybrid";

    const vectorPromise = usesVector
      ? this.searchVector(params)
      : Promise.resolve([] as VectorSearchResult[]);
    const keywordPromise = usesKeyword
      ? this.searchKeyword(params)
      : Promise.resolve([] as KeywordSearchResult[]);

    const [vectorOutcome, keywordOutcome] = await Promise.allSettled([
      vectorPromise,
      keywordPromise,
    ]);

    const vectorResults = vectorOutcome.status === "fulfilled"
      ? vectorOutcome.value
      : [];
    const keywordResults = keywordOutcome.status === "fulfilled"
      ? keywordOutcome.value
      : [];
    const errors = [
      ...(vectorOutcome.status === "rejected"
        ? [`Vector retrieval failed: ${errorMessage(vectorOutcome.reason)}`]
        : []),
      ...(keywordOutcome.status === "rejected"
        ? [`Keyword retrieval failed: ${errorMessage(keywordOutcome.reason)}`]
        : []),
    ];

    const requiredSearchesFailed =
      (plan.strategy === "vector" && vectorOutcome.status === "rejected") ||
      (plan.strategy === "keyword" && keywordOutcome.status === "rejected") ||
      (plan.strategy === "hybrid" &&
        vectorOutcome.status === "rejected" &&
        keywordOutcome.status === "rejected");

    if (requiredSearchesFailed) {
      throw new AggregateError(
        [
          ...(vectorOutcome.status === "rejected" ? [vectorOutcome.reason] : []),
          ...(keywordOutcome.status === "rejected" ? [keywordOutcome.reason] : []),
        ],
        errors.join("; ") || "Retrieval failed",
      );
    }

    const fused = this.fuse(plan.strategy, vectorResults, keywordResults);
    const candidateLimit = Math.max(
      plan.limits.vectorTopK,
      plan.limits.keywordTopK,
      plan.limits.finalTopK,
    );
    const results = sortResults(fused, plan.sort)
      .slice(0, candidateLimit);

    return {
      results,
      diagnostics: {
        strategy: plan.strategy,
        vectorResultCount: vectorResults.length,
        keywordResultCount: keywordResults.length,
        fusedResultCount: fused.length,
        candidateCount: results.length,
        degraded: errors.length > 0,
        errors,
      },
    };
  }
}
