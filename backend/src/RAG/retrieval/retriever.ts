import Embedding from "../ingestion/embeddingsProvider.js";
import { logger } from "../../utils/logger.js";
import { getVectorStore } from "../vectorStores/vectorStoreFactory.js";
import type VectorStore from "../vectorStores/vectorStore.js";
import type {
  OwnerId,
  VectorMetadata,
  VectorSearchFilters,
} from "../vectorStores/vectorStore.js";
import {
  HybridSearchExecutor,
  type HybridExecutionDiagnostics,
  type RankedSearchResult,
} from "./hybridSearchExecutor.js";
import {
  Reranker,
  type RerankDiagnostics,
} from "./reranker.js";
import { buildResolvedRetrievalPlan } from "./retrievalPlanner.js";
import type {
  PersonFilter,
  PersonResolutionCandidate,
  RetrievalPlan,
  RetrievalSort,
  RetrievalSourceScope,
  RetrievalStrategy,
} from "./retrievalPlan.js";

export interface RetrieveOptions {
  now?: Date;
  timezone?: string;
  source?: RetrievalSourceScope;
  defaultSource?: RetrievalSourceScope;
  strategy?: RetrievalStrategy;
  defaultStrategy?: RetrievalStrategy;
  sort?: RetrievalSort;
  defaultSort?: RetrievalSort;
  topK?: number;
  vectorTopK?: number;
  keywordTopK?: number;
  finalTopK?: number;
  sourceType?: string | null;
  occurredAfter?: Date | string | null;
  occurredBefore?: Date | string | null;
  metadata?: VectorMetadata;
  maxDistance?: number | string | null;
  conversationId?: string;
  enableRerank?: boolean;
  llmProvider?: string;
  model?: string | null;
}

export interface RetrievalClarificationCandidate {
  label: string;
  normalizedName: string | null;
  email: string | null;
  score: number;
}

export interface RetrievalClarification {
  required: true;
  reason: "ambiguous_person" | "unresolved_person";
  role: "sender" | "organizer";
  rawText: string;
  message: string;
  candidates: RetrievalClarificationCandidate[];
}

export interface RetrievalDiagnostics {
  plannerWarnings: string[];
  hybrid: HybridExecutionDiagnostics | null;
  rerank: RerankDiagnostics;
  clarificationRequired: boolean;
}

export interface RetrievalOutcome {
  chunks: RankedSearchResult[];
  plan: RetrievalPlan;
  clarification: RetrievalClarification | null;
  diagnostics: RetrievalDiagnostics;
}

interface RetrieverDependencies {
  vectorStore?: VectorStore;
  embedder?: Embedding;
  hybridSearchExecutor?: HybridSearchExecutor;
  reranker?: Reranker;
}

function toFiniteNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function mergeMetadata(
  planMetadata: VectorMetadata | undefined,
  optionMetadata: VectorMetadata | undefined,
): VectorMetadata {
  return {
    ...(planMetadata ?? {}),
    ...(optionMetadata ?? {}),
  };
}

function sourceScopeFromType(
  sourceType: string | null | undefined,
): RetrievalSourceScope | undefined {
  return sourceType === "gmail" || sourceType === "calendar"
    ? sourceType
    : undefined;
}

function buildSearchFilters(
  planFilters: VectorSearchFilters,
  options: RetrieveOptions,
): VectorSearchFilters {
  const metadata = mergeMetadata(planFilters.metadata, options.metadata);

  return {
    sourceType: options.sourceType ?? planFilters.sourceType ?? null,
    occurredAfter: options.occurredAfter ?? planFilters.occurredAfter ?? null,
    occurredBefore: options.occurredBefore ?? planFilters.occurredBefore ?? null,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

function clarificationRole(
  person: PersonFilter,
): "sender" | "organizer" | null {
  return person.role === "sender" || person.role === "organizer"
    ? person.role
    : null;
}

function toClarificationCandidate(
  candidate: PersonResolutionCandidate,
): RetrievalClarificationCandidate {
  const normalizedName = candidate.normalizedName ?? null;
  const email = candidate.email ?? null;
  const label = normalizedName && email
    ? `${normalizedName} <${email}>`
    : normalizedName ?? email ?? candidate.metadataValue;

  return {
    label,
    normalizedName,
    email,
    score: candidate.score,
  };
}

function buildClarification(plan: RetrievalPlan): RetrievalClarification | null {
  const unresolvedPerson = (plan.filters.people ?? []).find((person) =>
    clarificationRole(person) !== null && person.status !== "resolved"
  );

  if (!unresolvedPerson) return null;

  const role = clarificationRole(unresolvedPerson);
  if (!role) return null;

  const candidates = (unresolvedPerson.candidates ?? [])
    .slice(0, 5)
    .map(toClarificationCandidate);
  const roleLabel = role === "sender" ? "email sender" : "calendar organizer";

  if (unresolvedPerson.status === "ambiguous" && candidates.length > 0) {
    return {
      required: true,
      reason: "ambiguous_person",
      role,
      rawText: unresolvedPerson.rawText,
      message: `I found multiple ${roleLabel}s matching "${unresolvedPerson.rawText}". Which one did you mean: ${candidates.map((candidate) => candidate.label).join(", ")}?`,
      candidates,
    };
  }

  return {
    required: true,
    reason: "unresolved_person",
    role,
    rawText: unresolvedPerson.rawText,
    message: `I could not confidently match the ${roleLabel} "${unresolvedPerson.rawText}" in your synced data. Please provide their email address or a more specific name.`,
    candidates,
  };
}

function emptyRerankDiagnostics(
  enabled: boolean,
): RerankDiagnostics {
  return {
    enabled,
    attempted: false,
    applied: false,
    candidateCount: 0,
    returnedCount: 0,
    skippedReason: "no_candidates",
  };
}

export default class Retriever {
  private readonly vectorStore: VectorStore;
  private readonly embed: Embedding;
  private readonly hybridSearchExecutor: HybridSearchExecutor;
  private readonly reranker: Reranker;

  constructor({
    vectorStore = getVectorStore(),
    embedder = new Embedding(),
    hybridSearchExecutor,
    reranker = new Reranker(),
  }: RetrieverDependencies = {}) {
    this.vectorStore = vectorStore;
    this.embed = embedder;
    this.hybridSearchExecutor = hybridSearchExecutor ??
      new HybridSearchExecutor({ vectorStore: this.vectorStore });
    this.reranker = reranker;
  }

  async retrieve(
    query: string,
    userId: OwnerId,
    options: RetrieveOptions = {},
  ): Promise<RankedSearchResult[]> {
    const outcome = await this.retrieveWithDiagnostics(query, userId, options);
    return outcome.chunks;
  }

  async retrieveWithDiagnostics(
    query: string,
    userId: OwnerId,
    options: RetrieveOptions = {},
  ): Promise<RetrievalOutcome> {
    if (typeof query !== "string") {
      throw new Error("query must be a string");
    }

    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new Error("query must not be empty");
    }
    if (!userId) throw new Error("userId is required");

    try {
      const resolvedPlan = await buildResolvedRetrievalPlan({
        query: normalizedQuery,
        userId,
        now: options.now,
        timezone: options.timezone,
        options: {
          defaultSource: options.source ??
            options.defaultSource ??
            sourceScopeFromType(options.sourceType),
          defaultStrategy: options.strategy ?? options.defaultStrategy,
          defaultSort: options.sort ?? options.defaultSort,
          vectorTopK: options.topK ?? options.vectorTopK,
          keywordTopK: options.topK ?? options.keywordTopK,
          finalTopK: options.finalTopK ?? options.topK,
        },
      });
      const clarification = buildClarification(resolvedPlan.plan);
      const enableRerank = options.enableRerank ?? true;

      if (clarification) {
        logger.info("Retrieval requires person clarification", {
          userId,
          role: clarification.role,
          reason: clarification.reason,
        });

        return {
          chunks: [],
          plan: resolvedPlan.plan,
          clarification,
          diagnostics: {
            plannerWarnings: resolvedPlan.warnings ?? [],
            hybrid: null,
            rerank: emptyRerankDiagnostics(enableRerank),
            clarificationRequired: true,
          },
        };
      }

      const vectorSearch = resolvedPlan.vectorSearch;
      if (!vectorSearch) {
        throw new Error("Resolved retrieval plan did not include a vector search");
      }

      const filters = buildSearchFilters(vectorSearch.filters, options);
      const maxDistance = toFiniteNumber(options.maxDistance);
      const conversationId = options.conversationId ?? "retrieval";

      logger.info("Retrieving relevant documents", {
        userId,
        strategy: resolvedPlan.plan.strategy,
        sort: resolvedPlan.plan.sort,
        source: resolvedPlan.plan.filters.source,
        requiresMetadataResolution: resolvedPlan.plan.requiresMetadataResolution,
        warnings: resolvedPlan.warnings,
      });

      const execution = await this.hybridSearchExecutor.execute({
        plan: resolvedPlan.plan,
        vectorSearch,
        userId,
        filters,
        maxDistance,
        getQueryEmbedding: () => this.embed.embedQuery(vectorSearch.query, {
          userId,
          conversationId,
        }),
      });

      if (execution.diagnostics.degraded) {
        logger.warn("Hybrid retrieval completed with a degraded search path", {
          diagnostics: execution.diagnostics,
        });
      }

      const reranked = await this.reranker.rerank({
        query: resolvedPlan.plan.rawQuery,
        candidates: execution.results,
        finalTopK: resolvedPlan.plan.limits.finalTopK,
        sort: resolvedPlan.plan.sort,
        userId,
        conversationId,
        llmProvider: options.llmProvider,
        model: options.model,
        enabled: enableRerank,
      });

      logger.info("Retrieval completed", {
        userId,
        returnedCount: reranked.results.length,
        hybrid: execution.diagnostics,
        rerank: reranked.diagnostics,
      });

      return {
        chunks: reranked.results,
        plan: resolvedPlan.plan,
        clarification: null,
        diagnostics: {
          plannerWarnings: resolvedPlan.warnings ?? [],
          hybrid: execution.diagnostics,
          rerank: reranked.diagnostics,
          clarificationRequired: false,
        },
      };
    } catch (error) {
      logger.error("Error retrieving chunks", error);
      throw error;
    }
  }
}
