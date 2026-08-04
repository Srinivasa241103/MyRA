/**
 * FND-06 — Retriever and hybrid retrieval baseline.
 *
 * Freezes the behaviour agent routing must not silently change:
 *   1. Every search leg (vector and BM25) runs under the caller's user id, and
 *      nothing owned by another account survives into the results.
 *   2. The plan drives execution: strategy picks the legs, sort orders them,
 *      source scope and date range become store filters.
 *   3. Reciprocal-rank fusion ranks and deduplicates candidates, keeping the
 *      Postgres row when both legs found the same chunk (it carries the nested
 *      document metadata the context builder reads).
 *   4. One failed leg degrades; both failed legs throw.
 *   5. An unresolved or ambiguous person short-circuits into a clarification
 *      without touching the stores.
 *
 * Everything is injected: no PostgreSQL, no Chroma, no embedding provider.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import Retriever from "../../src/RAG/retrieval/retriever.js";
import { HybridSearchExecutor } from "../../src/RAG/retrieval/hybridSearchExecutor.js";
import type { RetrieveOptions } from "../../src/RAG/retrieval/retriever.js";
import type VectorStore from "../../src/RAG/vectorStores/vectorStore.js";
import type { KeywordSearchRepository } from "../../src/database/keywordSearchRepository.js";
import type { Reranker } from "../../src/RAG/retrieval/reranker.js";

import {
  FIXED_NOW,
  INTRUDER_USER_ID,
  OWNER_USER_ID,
  PassThroughReranker,
  RecordingKeywordRepository,
  RecordingVectorStore,
  StubEmbedding,
  StubPersonResolver,
  intruderVectorResult,
  keywordResult,
  resolvePersonAs,
  vectorResult,
} from "../fixtures/fnd06-baseline-fixtures.js";
import {
  assertKeywordSearchUserScoped,
  assertResultsBelongToUser,
  assertSourceMetadataPreserved,
  assertVectorSearchUserScoped,
} from "./baselineAssertions.js";

/* -------------------------------------------------------------------------- */
/* harness                                                                     */
/* -------------------------------------------------------------------------- */

interface Harness {
  retriever: Retriever;
  vectorStore: RecordingVectorStore;
  keywordRepository: RecordingKeywordRepository;
  embedder: StubEmbedding;
  reranker: PassThroughReranker;
}

function buildRetriever({
  vectorResults,
  keywordResults,
  vectorFailure = null,
  keywordFailure = null,
  personResolver,
}: {
  vectorResults?: ReturnType<typeof vectorResult>[];
  keywordResults?: ReturnType<typeof keywordResult>[];
  vectorFailure?: Error | null;
  keywordFailure?: Error | null;
  personResolver?: StubPersonResolver;
} = {}): Harness {
  const vectorStore = new RecordingVectorStore(
    vectorResults ?? [vectorResult()],
    vectorFailure,
  );
  const keywordRepository = new RecordingKeywordRepository(
    keywordResults ?? [keywordResult()],
    keywordFailure,
  );
  const embedder = new StubEmbedding();
  const reranker = new PassThroughReranker();

  const retriever = new Retriever({
    vectorStore: vectorStore as unknown as VectorStore,
    embedder: embedder as unknown as never,
    reranker: reranker as unknown as Reranker,
    // Always injected: the production resolver reads PostgreSQL, and the
    // planner extracts a person filter from phrases as innocuous as
    // "from last week", so an un-stubbed default would make this suite
    // depend on a live database.
    personResolver: personResolver ?? new StubPersonResolver(resolvePersonAs.resolved),
    hybridSearchExecutor: new HybridSearchExecutor({
      vectorStore,
      keywordRepository: keywordRepository as unknown as KeywordSearchRepository,
    }),
  });

  return { retriever, vectorStore, keywordRepository, embedder, reranker };
}

const BASE_OPTIONS: RetrieveOptions = { now: FIXED_NOW, enableRerank: false };

/* -------------------------------------------------------------------------- */
/* user isolation                                                              */
/* -------------------------------------------------------------------------- */

test("both retrieval legs run under the caller's user id", async () => {
  const harness = buildRetriever();

  const outcome = await harness.retriever.retrieveWithDiagnostics(
    "roadmap review email",
    OWNER_USER_ID,
    BASE_OPTIONS,
  );

  assertVectorSearchUserScoped(harness.vectorStore.calls, OWNER_USER_ID);
  assertKeywordSearchUserScoped(harness.keywordRepository.calls, OWNER_USER_ID);
  assertResultsBelongToUser(outcome.chunks, OWNER_USER_ID);
  assert.equal(harness.embedder.calls[0]?.userId, OWNER_USER_ID);
});

test("another account's chunks never reach the results", async () => {
  const harness = buildRetriever({
    vectorResults: [vectorResult(), intruderVectorResult()],
    keywordResults: [keywordResult()],
  });

  const outcome = await harness.retriever.retrieveWithDiagnostics(
    "roadmap review email",
    OWNER_USER_ID,
    BASE_OPTIONS,
  );

  assertResultsBelongToUser(outcome.chunks, OWNER_USER_ID);
  assert.ok(
    outcome.chunks.every((chunk) =>
      String(chunk.document.metadata?.user_id) !== String(INTRUDER_USER_ID)
    ),
  );
});

test("retrieval refuses to run without an identity or a query", async () => {
  const { retriever } = buildRetriever();

  await assert.rejects(
    () => retriever.retrieveWithDiagnostics("roadmap", "" as never, BASE_OPTIONS),
    /userId is required/,
  );
  await assert.rejects(
    () => retriever.retrieveWithDiagnostics("   ", OWNER_USER_ID, BASE_OPTIONS),
    /query must not be empty/,
  );
  await assert.rejects(
    () => retriever.retrieveWithDiagnostics(42 as never, OWNER_USER_ID, BASE_OPTIONS),
    /query must be a string/,
  );
});

/* -------------------------------------------------------------------------- */
/* source metadata and provenance                                              */
/* -------------------------------------------------------------------------- */

test("retrieved chunks keep the source metadata citations depend on", async () => {
  const harness = buildRetriever({
    vectorResults: [vectorResult({ sourceType: "gmail" })],
    keywordResults: [
      keywordResult({ sourceType: "calendar", documentPk: 2, chunkId: "chunk-2-0" }),
    ],
  });

  const outcome = await harness.retriever.retrieveWithDiagnostics(
    "roadmap review",
    OWNER_USER_ID,
    BASE_OPTIONS,
  );

  assertSourceMetadataPreserved(outcome.chunks);
  assert.deepEqual(
    [...new Set(outcome.chunks.map((chunk) => chunk.source_type))].sort(),
    ["calendar", "gmail"],
  );
});

test("fusion keeps the Postgres row when both legs return the same chunk", async () => {
  // Same document + chunk index on both sides: the keyword row wins because it
  // carries the nested document metadata the context builder reads.
  const harness = buildRetriever({
    vectorResults: [vectorResult({ documentPk: 7, metadata: { user_id: String(OWNER_USER_ID) } })],
    keywordResults: [keywordResult({ documentPk: 7 })],
  });

  const outcome = await harness.retriever.retrieveWithDiagnostics(
    "roadmap review",
    OWNER_USER_ID,
    BASE_OPTIONS,
  );

  assert.equal(outcome.chunks.length, 1, "duplicate chunk was not fused");
  const [chunk] = outcome.chunks;
  assert.equal(chunk.retrieval.vector_rank, 1);
  assert.equal(chunk.retrieval.keyword_rank, 1);
  assert.equal(chunk.retrieval.keyword_score, 3.5);
  assert.deepEqual(chunk.retrieval.matched_terms, ["roadmap"]);
  assert.equal(chunk.document.metadata?.subject, "Quarterly roadmap review");
  assert.equal(chunk.distance, 0.12, "vector distance survived fusion");
});

/* -------------------------------------------------------------------------- */
/* plan-driven execution                                                       */
/* -------------------------------------------------------------------------- */

test("a source-scoped query filters both legs to that source", async () => {
  const harness = buildRetriever();

  const outcome = await harness.retriever.retrieveWithDiagnostics(
    "roadmap emails last week",
    OWNER_USER_ID,
    BASE_OPTIONS,
  );

  assert.equal(outcome.plan.filters.source, "gmail");
  assert.equal(harness.vectorStore.calls[0]?.filters?.sourceType, "gmail");
  assert.equal(harness.keywordRepository.calls[0]?.filters?.sourceType, "gmail");
  assert.ok(
    harness.vectorStore.calls[0]?.filters?.occurredAfter,
    "the detected date range did not reach the store filters",
  );
});

test("a latest-sorted calendar query plans sort and source together", async () => {
  const harness = buildRetriever({
    vectorResults: [
      vectorResult({
        sourceType: "calendar",
        documentPk: 3,
        occurredAt: "2026-07-01T10:00:00.000Z",
      }),
      vectorResult({
        sourceType: "calendar",
        documentPk: 4,
        occurredAt: "2026-08-02T10:00:00.000Z",
      }),
    ],
    keywordResults: [],
  });

  const outcome = await harness.retriever.retrieveWithDiagnostics(
    "latest meeting on my calendar",
    OWNER_USER_ID,
    BASE_OPTIONS,
  );

  assert.equal(outcome.plan.filters.source, "calendar");
  assert.equal(outcome.plan.sort, "latest");
  assert.equal(outcome.chunks[0]?.document.id, 4, "latest sort was not applied");
});

test("explicit caller options override the planned filters", async () => {
  const harness = buildRetriever();

  await harness.retriever.retrieveWithDiagnostics("roadmap", OWNER_USER_ID, {
    ...BASE_OPTIONS,
    sourceType: "calendar",
    metadata: { organizer_email: "priya@example.com" },
  });

  const filters = harness.vectorStore.calls[0]?.filters;
  assert.equal(filters?.sourceType, "calendar");
  assert.equal(filters?.metadata?.organizer_email, "priya@example.com");
});

test("topK options flow into the planned limits", async () => {
  const harness = buildRetriever();

  const outcome = await harness.retriever.retrieveWithDiagnostics(
    "roadmap",
    OWNER_USER_ID,
    { ...BASE_OPTIONS, topK: 5, finalTopK: 3 },
  );

  assert.equal(outcome.plan.limits.vectorTopK, 5);
  assert.equal(outcome.plan.limits.keywordTopK, 5);
  assert.equal(outcome.plan.limits.finalTopK, 3);
  assert.equal(harness.vectorStore.calls[0]?.topK, 5);
  assert.equal(harness.keywordRepository.calls[0]?.topK, 5);
});

test("maxDistance drops vector hits beyond the threshold", async () => {
  const harness = buildRetriever({
    vectorResults: [
      vectorResult({ documentPk: 1, distance: 0.1 }),
      vectorResult({ documentPk: 2, distance: 0.9 }),
    ],
    keywordResults: [],
  });

  const outcome = await harness.retriever.retrieveWithDiagnostics(
    "roadmap",
    OWNER_USER_ID,
    { ...BASE_OPTIONS, maxDistance: 0.5 },
  );

  assert.equal(outcome.chunks.length, 1);
  assert.equal(outcome.chunks[0]?.document.id, 1);
});

/* -------------------------------------------------------------------------- */
/* degraded and failed retrieval                                               */
/* -------------------------------------------------------------------------- */

test("a failed keyword leg degrades instead of failing the request", async () => {
  const harness = buildRetriever({
    keywordFailure: new Error("bm25 unavailable"),
  });

  const outcome = await harness.retriever.retrieveWithDiagnostics(
    "roadmap review",
    OWNER_USER_ID,
    BASE_OPTIONS,
  );

  assert.equal(outcome.diagnostics.hybrid?.degraded, true);
  assert.match(outcome.diagnostics.hybrid?.errors[0] ?? "", /Keyword retrieval failed/);
  assert.equal(outcome.chunks.length, 1, "the surviving vector leg still answered");
  assertResultsBelongToUser(outcome.chunks, OWNER_USER_ID);
});

test("a failed vector leg degrades instead of failing the request", async () => {
  const harness = buildRetriever({
    vectorFailure: new Error("chroma unavailable"),
  });

  const outcome = await harness.retriever.retrieveWithDiagnostics(
    "roadmap review",
    OWNER_USER_ID,
    BASE_OPTIONS,
  );

  assert.equal(outcome.diagnostics.hybrid?.degraded, true);
  assert.match(outcome.diagnostics.hybrid?.errors[0] ?? "", /Vector retrieval failed/);
  assert.equal(outcome.chunks.length, 1, "the surviving keyword leg still answered");
});

test("both legs failing surfaces an aggregate error", async () => {
  const harness = buildRetriever({
    vectorFailure: new Error("chroma unavailable"),
    keywordFailure: new Error("bm25 unavailable"),
  });

  await assert.rejects(
    () =>
      harness.retriever.retrieveWithDiagnostics(
        "roadmap review",
        OWNER_USER_ID,
        BASE_OPTIONS,
      ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.match(error.message, /Vector retrieval failed/);
      assert.match(error.message, /Keyword retrieval failed/);
      return true;
    },
  );
});

test("diagnostics report the per-leg counts", async () => {
  const harness = buildRetriever({
    vectorResults: [vectorResult({ documentPk: 1 }), vectorResult({ documentPk: 2 })],
    keywordResults: [keywordResult({ documentPk: 2 })],
  });

  const outcome = await harness.retriever.retrieveWithDiagnostics(
    "roadmap review",
    OWNER_USER_ID,
    BASE_OPTIONS,
  );

  assert.deepEqual(
    {
      strategy: outcome.diagnostics.hybrid?.strategy,
      vectorResultCount: outcome.diagnostics.hybrid?.vectorResultCount,
      keywordResultCount: outcome.diagnostics.hybrid?.keywordResultCount,
      fusedResultCount: outcome.diagnostics.hybrid?.fusedResultCount,
      degraded: outcome.diagnostics.hybrid?.degraded,
      clarificationRequired: outcome.diagnostics.clarificationRequired,
    },
    {
      strategy: "hybrid",
      vectorResultCount: 2,
      keywordResultCount: 1,
      fusedResultCount: 2,
      degraded: false,
      clarificationRequired: false,
    },
  );
});

/* -------------------------------------------------------------------------- */
/* clarification                                                               */
/* -------------------------------------------------------------------------- */

test("an ambiguous sender asks for clarification without searching", async () => {
  const harness = buildRetriever({
    personResolver: new StubPersonResolver(resolvePersonAs.ambiguous),
  });

  const outcome = await harness.retriever.retrieveWithDiagnostics(
    "emails from anand about the roadmap",
    OWNER_USER_ID,
    BASE_OPTIONS,
  );

  assert.equal(outcome.clarification?.reason, "ambiguous_person");
  assert.equal(outcome.clarification?.role, "sender");
  assert.match(outcome.clarification?.message ?? "", /Which one did you mean/);
  assert.equal(outcome.clarification?.candidates.length, 2);
  assert.equal(outcome.clarification?.candidates[0]?.label, "anand rao <anand@example.com>");

  assert.deepEqual(outcome.chunks, []);
  assert.equal(outcome.diagnostics.clarificationRequired, true);
  assert.equal(harness.vectorStore.calls.length, 0, "the vector store was still queried");
  assert.equal(
    harness.keywordRepository.calls.length,
    0,
    "the keyword repository was still queried",
  );
});

test("an unresolvable sender asks for an address instead of guessing", async () => {
  const harness = buildRetriever({
    personResolver: new StubPersonResolver(resolvePersonAs.unresolved),
  });

  const outcome = await harness.retriever.retrieveWithDiagnostics(
    "emails from anand about the roadmap",
    OWNER_USER_ID,
    BASE_OPTIONS,
  );

  assert.equal(outcome.clarification?.reason, "unresolved_person");
  assert.match(outcome.clarification?.message ?? "", /email address or a more specific name/);
  assert.deepEqual(outcome.diagnostics.plannerWarnings, [
    "Could not resolve sender: anand",
  ]);
});

test("a resolved sender narrows the search instead of clarifying", async () => {
  const resolver = new StubPersonResolver(resolvePersonAs.resolved);
  const harness = buildRetriever({ personResolver: resolver });

  const outcome = await harness.retriever.retrieveWithDiagnostics(
    "emails from anand about the roadmap",
    OWNER_USER_ID,
    BASE_OPTIONS,
  );

  assert.equal(outcome.clarification, null);
  assert.equal(resolver.calls[0]?.userId, OWNER_USER_ID);
  assert.equal(
    harness.vectorStore.calls[0]?.filters?.metadata?.sender_email,
    "anand@example.com",
    "the resolved person did not become a metadata filter",
  );
  assertResultsBelongToUser(outcome.chunks, OWNER_USER_ID);
});

/* -------------------------------------------------------------------------- */
/* retrieve() convenience wrapper                                              */
/* -------------------------------------------------------------------------- */

test("retrieve() returns only the chunks of retrieveWithDiagnostics", async () => {
  const harness = buildRetriever();

  const chunks = await harness.retriever.retrieve(
    "roadmap review",
    OWNER_USER_ID,
    BASE_OPTIONS,
  );

  assert.equal(chunks.length, 1);
  assertSourceMetadataPreserved(chunks);
});
