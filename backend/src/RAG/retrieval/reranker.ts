import { z } from "zod";
import LLMService from "../query/llmService.js";
import { logger } from "../../utils/logger.js";
import { LLM_INVOCATION_TYPES } from "../../utils/constants.js";
import type { OwnerId } from "../vectorStores/vectorStore.js";
import type { RetrievalSort } from "./retrievalPlan.js";
import type { RankedSearchResult } from "./hybridSearchExecutor.js";

export type RerankSkipReason =
  | "disabled"
  | "chronological_sort"
  | "insufficient_candidates"
  | "no_candidates"
  | "rerank_failed"
  | null;

export interface RerankDiagnostics {
  enabled: boolean;
  attempted: boolean;
  applied: boolean;
  candidateCount: number;
  returnedCount: number;
  skippedReason: RerankSkipReason;
  error?: string;
}

export interface RerankResult {
  results: RankedSearchResult[];
  diagnostics: RerankDiagnostics;
}

export interface RerankInput {
  query: string;
  candidates: RankedSearchResult[];
  finalTopK: number;
  sort: RetrievalSort;
  userId: OwnerId;
  conversationId: string;
  llmProvider?: string;
  model?: string | null;
  enabled?: boolean;
}

interface RerankerDependencies {
  llmService?: Pick<LLMService, "generateStructuredResponse">;
}

interface PromptCandidate {
  candidateId: string;
  source: string;
  date: string | null;
  author: string | null;
  title: string | null;
  content: string;
}

const MAX_CONTENT_CHARS = 1600;

const RERANK_SCHEMA = z.object({
  rankedCandidates: z.array(z.object({
    candidateId: z.string().min(1),
    relevanceScore: z.number().min(0).max(1),
  })).min(1),
});

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nestedMetadata(
  result: RankedSearchResult,
  source: "gmail" | "calendar",
): Record<string, unknown> {
  const metadata = result.document?.metadata ?? {};
  const nested = metadata[source];
  return nested && typeof nested === "object"
    ? nested as Record<string, unknown>
    : metadata;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function candidateTitle(result: RankedSearchResult): string | null {
  if (result.source_type === "gmail") {
    const metadata = nestedMetadata(result, "gmail");
    return stringValue(metadata.subject) ?? stringValue(metadata.title_norm);
  }

  if (result.source_type === "calendar") {
    const metadata = nestedMetadata(result, "calendar");
    return stringValue(metadata.summary) ??
      stringValue(metadata.title) ??
      stringValue(metadata.title_norm);
  }

  return stringValue(result.document?.metadata?.title) ??
    stringValue(result.document?.metadata?.title_norm);
}

function candidateAuthor(result: RankedSearchResult): string | null {
  if (result.source_type === "gmail") {
    const metadata = nestedMetadata(result, "gmail");
    return stringValue(metadata.from) ??
      stringValue(metadata.sender_email) ??
      result.document?.author ?? null;
  }

  if (result.source_type === "calendar") {
    const metadata = nestedMetadata(result, "calendar");
    const organizer = metadata.organizer;
    if (organizer && typeof organizer === "object") {
      const organizerRecord = organizer as Record<string, unknown>;
      return stringValue(organizerRecord.displayName) ??
        stringValue(organizerRecord.email) ??
        result.document?.author ?? null;
    }

    return stringValue(metadata.organizer_name_norm) ??
      stringValue(metadata.organizer_email) ??
      result.document?.author ?? null;
  }

  return result.document?.author ?? null;
}

function candidateDate(result: RankedSearchResult): string | null {
  if (!result.occurred_at) return null;
  const date = new Date(result.occurred_at);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toPromptCandidates(
  candidates: RankedSearchResult[],
): { promptCandidates: PromptCandidate[]; candidateMap: Map<string, RankedSearchResult> } {
  const candidateMap = new Map<string, RankedSearchResult>();
  const promptCandidates = candidates.map((candidate, index) => {
    const candidateId = `candidate_${index + 1}`;
    candidateMap.set(candidateId, candidate);

    return {
      candidateId,
      source: candidate.source_type,
      date: candidateDate(candidate),
      author: candidateAuthor(candidate),
      title: candidateTitle(candidate),
      content: candidate.content.slice(0, MAX_CONTENT_CHARS),
    };
  });

  return { promptCandidates, candidateMap };
}

function buildRerankMessages(
  query: string,
  candidates: PromptCandidate[],
): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content: [
        "Rank personal-data retrieval candidates by relevance to the user's standalone query.",
        "Honor exact source, person, title, and time requirements before semantic similarity.",
        "Do not answer the query. Return every candidate once through the required structured output.",
      ].join(" "),
    },
    {
      role: "user",
      content: `Query:\n${query}\n\nCandidates:\n${JSON.stringify(candidates)}`,
    },
  ];
}

function withRerankMetadata(
  result: RankedSearchResult,
  rank: number | null,
  score: number | null,
): RankedSearchResult {
  return {
    ...result,
    retrieval: {
      ...result.retrieval,
      rerank_rank: rank,
      rerank_score: score,
    },
  };
}

function fallbackResult(
  candidates: RankedSearchResult[],
  finalTopK: number,
  enabled: boolean,
  skippedReason: RerankSkipReason,
  attempted = false,
  error?: string,
): RerankResult {
  const results = candidates
    .slice(0, finalTopK)
    .map((candidate) => withRerankMetadata(candidate, null, null));

  return {
    results,
    diagnostics: {
      enabled,
      attempted,
      applied: false,
      candidateCount: candidates.length,
      returnedCount: results.length,
      skippedReason,
      ...(error ? { error } : {}),
    },
  };
}

export class Reranker {
  private readonly llmService: Pick<LLMService, "generateStructuredResponse">;

  constructor({ llmService = new LLMService() }: RerankerDependencies = {}) {
    this.llmService = llmService;
  }

  async rerank({
    query,
    candidates,
    finalTopK,
    sort,
    userId,
    conversationId,
    llmProvider = "OpenAI",
    model = null,
    enabled = true,
  }: RerankInput): Promise<RerankResult> {
    const limit = positiveInteger(finalTopK, 8);

    if (candidates.length === 0) {
      return fallbackResult(candidates, limit, enabled, "no_candidates");
    }
    if (!enabled) {
      return fallbackResult(candidates, limit, false, "disabled");
    }
    if (sort !== "relevance") {
      return fallbackResult(candidates, limit, true, "chronological_sort");
    }
    if (candidates.length < 2) {
      return fallbackResult(candidates, limit, true, "insufficient_candidates");
    }

    const { promptCandidates, candidateMap } = toPromptCandidates(candidates);

    try {
      const response = await this.llmService.generateStructuredResponse({
        llmProvider,
        model,
        schema: RERANK_SCHEMA,
        messages: buildRerankMessages(query, promptCandidates),
        userId,
        conversationId,
        invocationType: LLM_INVOCATION_TYPES.RERANK,
        temperature: 0,
        maxTokens: Math.max(300, candidates.length * 35),
        structuredConfig: { name: "hybrid_retrieval_ranking" },
      }) as z.infer<typeof RERANK_SCHEMA>;

      const seen = new Set<string>();
      const ranked: Array<{ result: RankedSearchResult; score: number }> = [];

      for (const item of response.rankedCandidates) {
        const candidate = candidateMap.get(item.candidateId);
        if (!candidate || seen.has(item.candidateId)) continue;
        seen.add(item.candidateId);
        ranked.push({ result: candidate, score: item.relevanceScore });
      }

      if (ranked.length === 0) {
        throw new Error("Reranker returned no valid candidate IDs");
      }

      for (const promptCandidate of promptCandidates) {
        if (seen.has(promptCandidate.candidateId)) continue;
        const candidate = candidateMap.get(promptCandidate.candidateId);
        if (candidate) ranked.push({ result: candidate, score: 0 });
      }

      const results = ranked
        .slice(0, limit)
        .map(({ result, score }, index) =>
          withRerankMetadata(result, index + 1, score)
        );

      return {
        results,
        diagnostics: {
          enabled: true,
          attempted: true,
          applied: true,
          candidateCount: candidates.length,
          returnedCount: results.length,
          skippedReason: null,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("Retrieval reranking failed; preserving fused ranking", {
        conversationId,
        error: message,
      });
      return fallbackResult(
        candidates,
        limit,
        true,
        "rerank_failed",
        true,
        message,
      );
    }
  }
}
