import assert from "node:assert/strict";
import { HybridSearchExecutor } from "../src/RAG/retrieval/hybridSearchExecutor.js";
import type {
  PlannedVectorSearch,
  RetrievalPlan,
  RetrievalStrategy,
} from "../src/RAG/retrieval/retrievalPlan.js";
import type { VectorSearchResult } from "../src/RAG/vectorStores/vectorStore.js";
import type { KeywordSearchResult } from "../src/database/keywordSearchRepository.js";

function vectorResult(
  documentId: number,
  chunkIndex: number,
  distance: number,
  occurredAt: string,
): VectorSearchResult {
  return {
    chunk_id: `vector:${documentId}:${chunkIndex}`,
    content: `vector content ${documentId}:${chunkIndex}`,
    chunk_index: chunkIndex,
    source_type: "gmail",
    occurred_at: occurredAt,
    distance,
    document: {
      id: documentId,
      source_id: `gmail_${documentId}`,
      author: "sender@example.com",
      metadata: { sender_email: "sender@example.com" },
    },
  };
}

function keywordResult(
  documentId: number,
  chunkIndex: number,
  keywordScore: number,
  occurredAt: string,
): KeywordSearchResult {
  return {
    chunk_id: documentId * 100 + chunkIndex,
    content: `keyword content ${documentId}:${chunkIndex}`,
    chunk_index: chunkIndex,
    source_type: "gmail",
    occurred_at: occurredAt,
    distance: Number.POSITIVE_INFINITY,
    keyword_score: keywordScore,
    matched_terms: ["email"],
    document: {
      id: documentId,
      source_id: `gmail_${documentId}`,
      author: "sender@example.com",
      metadata: { gmail: { from: "sender@example.com" } },
    },
  };
}

function plan(
  strategy: RetrievalStrategy = "hybrid",
  sort: RetrievalPlan["sort"] = "relevance",
): RetrievalPlan {
  return {
    rawQuery: "email from sender",
    semanticQuery: "email",
    contentQuery: null,
    strategy,
    sort,
    temporalIntent: sort === "relevance" ? "none" : sort,
    filters: { source: "gmail" },
    limits: {
      vectorTopK: 20,
      keywordTopK: 20,
      finalTopK: 10,
    },
    requiresMetadataResolution: false,
  };
}

const plannedVectorSearch: PlannedVectorSearch = {
  query: "email",
  userId: 3,
  topK: 20,
  filters: { sourceType: "gmail" },
  sort: "relevance",
};

async function testFusionAndDeduplication(): Promise<void> {
  const executor = new HybridSearchExecutor({
    vectorStore: {
      search: async () => [
        vectorResult(1, 0, 0.1, "2026-01-01T00:00:00.000Z"),
        vectorResult(2, 0, 0.2, "2026-01-02T00:00:00.000Z"),
      ],
    },
    keywordRepository: {
      search: async () => [
        keywordResult(2, 0, 8, "2026-01-02T00:00:00.000Z"),
        keywordResult(3, 0, 4, "2026-01-03T00:00:00.000Z"),
      ],
    },
  });

  const execution = await executor.execute({
    plan: plan(),
    vectorSearch: plannedVectorSearch,
    userId: 3,
    filters: plannedVectorSearch.filters,
    getQueryEmbedding: async () => [0.1, 0.2],
  });

  assert.equal(execution.results.length, 3);
  assert.equal(execution.results[0].document.id, 2);
  assert.equal(execution.results[0].retrieval.vector_rank, 2);
  assert.equal(execution.results[0].retrieval.keyword_rank, 1);
  assert.match(execution.results[0].content, /^keyword content/);
  assert.equal(execution.diagnostics.fusedResultCount, 3);
}

async function testLatestSort(): Promise<void> {
  const executor = new HybridSearchExecutor({
    vectorStore: {
      search: async () => [
        vectorResult(1, 0, 0.1, "2026-01-01T00:00:00.000Z"),
      ],
    },
    keywordRepository: {
      search: async () => [
        keywordResult(2, 0, 5, "2026-02-01T00:00:00.000Z"),
      ],
    },
  });

  const execution = await executor.execute({
    plan: plan("hybrid", "latest"),
    vectorSearch: plannedVectorSearch,
    userId: 3,
    getQueryEmbedding: async () => [0.1, 0.2],
  });

  assert.equal(execution.results[0].document.id, 2);
}

async function testHybridFallback(): Promise<void> {
  const executor = new HybridSearchExecutor({
    vectorStore: {
      search: async () => {
        throw new Error("vector unavailable");
      },
    },
    keywordRepository: {
      search: async () => [
        keywordResult(3, 0, 4, "2026-01-03T00:00:00.000Z"),
      ],
    },
  });

  const execution = await executor.execute({
    plan: plan(),
    vectorSearch: plannedVectorSearch,
    userId: 3,
    getQueryEmbedding: async () => [0.1, 0.2],
  });

  assert.equal(execution.results.length, 1);
  assert.equal(execution.diagnostics.degraded, true);
  assert.match(execution.diagnostics.errors[0], /vector unavailable/);
}

async function testKeywordOnlySkipsEmbedding(): Promise<void> {
  let vectorWasCalled = false;
  let embeddingWasCalled = false;
  const executor = new HybridSearchExecutor({
    vectorStore: {
      search: async () => {
        vectorWasCalled = true;
        return [];
      },
    },
    keywordRepository: {
      search: async () => [
        keywordResult(4, 0, 3, "2026-01-04T00:00:00.000Z"),
      ],
    },
  });

  const execution = await executor.execute({
    plan: plan("keyword"),
    vectorSearch: plannedVectorSearch,
    userId: 3,
    getQueryEmbedding: async () => {
      embeddingWasCalled = true;
      return [0.1, 0.2];
    },
  });

  assert.equal(execution.results.length, 1);
  assert.equal(vectorWasCalled, false);
  assert.equal(embeddingWasCalled, false);
}

await testFusionAndDeduplication();
await testLatestSort();
await testHybridFallback();
await testKeywordOnlySkipsEmbedding();

console.log("Hybrid search executor tests passed");
