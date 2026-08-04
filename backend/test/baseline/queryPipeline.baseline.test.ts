/**
 * FND-06 — QueryPipeline baseline.
 *
 * The pipeline is the whole current product: history → rewrite → retrieve →
 * build context → generate → persist. Agent routing (AGT-03) will sit in front
 * of it, so this suite pins the observable contract it must keep honouring:
 *   1. The status stream is a fixed, ordered vocabulary and only generation is
 *      cancellable.
 *   2. Retrieval runs on the *transformed* query, under the caller's user id.
 *   3. Every completed turn is persisted once, under the caller's identity,
 *      with the source count, the distinct source types, and the retrieval
 *      metadata attached.
 *   4. A clarification answers from the retriever without calling the LLM, and
 *      is still persisted.
 *   5. Stops, aborts, and failures are distinguishable downstream.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import QueryPipeline from "../../src/RAG/query/queryPipeline.js";
import type {
  QueryPipelineStreamStatus,
} from "../../src/RAG/query/queryPipeline.js";
import type Retriever from "../../src/RAG/retrieval/retriever.js";
import type {
  RetrievalOutcome,
  RetrieveOptions,
} from "../../src/RAG/retrieval/retriever.js";
import type { RankedSearchResult } from "../../src/RAG/retrieval/hybridSearchExecutor.js";
import { LLM_INVOCATION_TYPES } from "../../src/utils/constants.js";

import {
  CONVERSATION_ID,
  OWNER_USER_ID,
  RecordingLLMService,
  RecordingMemoryService,
  rankedResult,
} from "../fixtures/fnd06-baseline-fixtures.js";
import {
  assertConversationSaveUserScoped,
  assertResultsBelongToUser,
  assertSourceMetadataPreserved,
} from "./baselineAssertions.js";

/* -------------------------------------------------------------------------- */
/* doubles                                                                     */
/* -------------------------------------------------------------------------- */

class StubRetriever {
  readonly calls: Array<{
    query: string;
    userId: string | number;
    options: RetrieveOptions;
  }> = [];

  constructor(private readonly outcome: RetrievalOutcome) {}

  async retrieveWithDiagnostics(
    query: string,
    userId: string | number,
    options: RetrieveOptions = {},
  ): Promise<RetrievalOutcome> {
    this.calls.push({ query, userId, options });
    return this.outcome;
  }
}

class StubQueryTransformer {
  readonly calls: Array<{ query: string; userId: string | number }> = [];

  constructor(private readonly rewrittenQuery: string | null = null) {}

  async transform({ query, userId }: { query: string; userId: string | number }) {
    this.calls.push({ query, userId });

    return this.rewrittenQuery
      ? {
        originalQuery: query,
        query: this.rewrittenQuery,
        rewritten: true,
        attempted: true,
        reason: "context_dependent" as const,
      }
      : {
        originalQuery: query,
        query,
        rewritten: false,
        attempted: false,
        reason: "standalone" as const,
      };
  }
}

function outcomeWith(chunks: RankedSearchResult[]): RetrievalOutcome {
  return {
    chunks,
    plan: {
      rawQuery: "roadmap review",
      semanticQuery: "roadmap review",
      contentQuery: "roadmap review",
      strategy: "hybrid",
      sort: "relevance",
      temporalIntent: "none",
      filters: { source: "all", dateRange: null, people: [] },
      limits: { vectorTopK: 20, keywordTopK: 20, finalTopK: 8 },
      requiresMetadataResolution: false,
    },
    clarification: null,
    diagnostics: {
      plannerWarnings: [],
      hybrid: {
        strategy: "hybrid",
        vectorResultCount: chunks.length,
        keywordResultCount: chunks.length,
        fusedResultCount: chunks.length,
        candidateCount: chunks.length,
        degraded: false,
        errors: [],
      },
      rerank: {
        enabled: true,
        attempted: false,
        applied: false,
        candidateCount: chunks.length,
        returnedCount: chunks.length,
        skippedReason: "disabled",
      },
      clarificationRequired: false,
    },
  };
}

const CLARIFICATION_OUTCOME: RetrievalOutcome = {
  ...outcomeWith([]),
  clarification: {
    required: true,
    reason: "ambiguous_person",
    role: "sender",
    rawText: "anand",
    message: 'I found multiple email senders matching "anand". Which one did you mean: Anand Rao <anand@example.com>, Anand Kumar <anand.k@example.com>?',
    candidates: [
      {
        label: "Anand Rao <anand@example.com>",
        normalizedName: "anand rao",
        email: "anand@example.com",
        score: 0.61,
      },
    ],
  },
  diagnostics: { ...outcomeWith([]).diagnostics, clarificationRequired: true },
};

interface Harness {
  pipeline: QueryPipeline;
  retriever: StubRetriever;
  transformer: StubQueryTransformer;
  memory: RecordingMemoryService;
  llm: RecordingLLMService;
}

function buildPipeline({
  outcome = outcomeWith([
    rankedResult({ documentPk: 1, sourceType: "gmail" }),
    rankedResult({ documentPk: 2, sourceType: "calendar" }),
  ]),
  rewrittenQuery = null,
  history = [],
  tokens,
  llmOptions = {},
}: {
  outcome?: RetrievalOutcome;
  rewrittenQuery?: string | null;
  history?: Array<{ role: string; content: string }>;
  tokens?: string[];
  llmOptions?: { stopped?: boolean; failWith?: Error };
} = {}): Harness {
  const retriever = new StubRetriever(outcome);
  const transformer = new StubQueryTransformer(rewrittenQuery);
  const memory = new RecordingMemoryService(history);
  const llm = new RecordingLLMService(tokens, llmOptions);

  const pipeline = new QueryPipeline({
    retriever: retriever as unknown as Retriever,
    queryTransformer: transformer as unknown as never,
    memoryService: memory as unknown as never,
    llmService: llm as unknown as never,
  });

  return { pipeline, retriever, transformer, memory, llm };
}

function collectStream() {
  const statuses: QueryPipelineStreamStatus[] = [];
  const tokens: string[] = [];
  const contexts: RankedSearchResult[][] = [];

  return {
    statuses,
    tokens,
    contexts,
    stream: {
      onStatus: (status: QueryPipelineStreamStatus) => {
        statuses.push(status);
      },
      onToken: (text: string) => {
        tokens.push(text);
      },
      onContext: (sources: RankedSearchResult[]) => {
        contexts.push(sources);
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* the streaming happy path                                                    */
/* -------------------------------------------------------------------------- */

test("a streamed answer emits the frozen status sequence", async () => {
  const harness = buildPipeline();
  const { stream, statuses, tokens, contexts } = collectStream();

  const response = await harness.pipeline.run({
    query: "roadmap review",
    conversationId: CONVERSATION_ID,
    userId: OWNER_USER_ID,
    stream,
  });

  assert.deepEqual(
    statuses.map((status) => status.stage),
    ["query_refinement", "collecting_data", "building_context", "generating"],
  );
  assert.ok(statuses.every((status) => status.flow === "rag"));
  assert.deepEqual(
    statuses.filter((status) => status.cancellable).map((status) => status.stage),
    ["generating"],
    "only generation may advertise itself as cancellable",
  );
  assert.equal(
    statuses[2]?.detail,
    "2 relevant items",
    "the building_context detail is part of the UI contract",
  );

  assert.deepEqual(tokens, ["Anand ", "shared ", "the roadmap."]);
  assert.equal(response.answer, "Anand shared the roadmap.");
  assert.equal(contexts.length, 1, "context is published exactly once");
  assertSourceMetadataPreserved(contexts[0]);
  assertResultsBelongToUser(response.sources, OWNER_USER_ID);

  assert.equal(response.clarificationRequired, false);
  assert.equal(response.stopped, false);
  assert.equal(response.conversationId, CONVERSATION_ID);
  assert.equal(response.provider, "OpenAI");
  assert.ok(response.duration >= 0);
});

test("a single retrieved item uses the singular detail string", async () => {
  const harness = buildPipeline({
    outcome: outcomeWith([rankedResult({ documentPk: 1 })]),
  });
  const { stream, statuses } = collectStream();

  await harness.pipeline.run({
    query: "roadmap review",
    conversationId: CONVERSATION_ID,
    userId: OWNER_USER_ID,
    stream,
  });

  assert.equal(statuses[2]?.detail, "1 relevant item");
});

test("retrieval runs on the rewritten query under the caller's identity", async () => {
  const harness = buildPipeline({
    rewrittenQuery: "roadmap review emails from Anand today",
    history: [{ role: "user", content: "emails from Anand" }],
  });

  await harness.pipeline.run({
    query: "and today?",
    conversationId: CONVERSATION_ID,
    userId: OWNER_USER_ID,
    llmProvider: "Anthropic",
    model: "claude-test",
  });

  assert.deepEqual(harness.transformer.calls, [
    { query: "and today?", userId: OWNER_USER_ID },
  ]);

  const [call] = harness.retriever.calls;
  assert.equal(call?.query, "roadmap review emails from Anand today");
  assert.equal(call?.userId, OWNER_USER_ID);
  assert.equal(call?.options.conversationId, CONVERSATION_ID);
  assert.equal(call?.options.llmProvider, "Anthropic");
  assert.equal(call?.options.model, "claude-test");
  assert.equal(call?.options.enableRerank, true, "rerank defaults on");

  assert.deepEqual(harness.memory.historyCalls, [
    { conversationId: CONVERSATION_ID, userId: OWNER_USER_ID },
  ]);
});

test("the retrieval metadata returned to the caller mirrors the retriever", async () => {
  const harness = buildPipeline();

  const response = await harness.pipeline.run({
    query: "roadmap review",
    conversationId: CONVERSATION_ID,
    userId: OWNER_USER_ID,
  });

  assert.equal(response.retrieval.queryTransform.reason, "standalone");
  assert.equal(response.retrieval.plan.strategy, "hybrid");
  assert.equal(response.retrieval.clarification, null);
  assert.equal(response.retrieval.diagnostics.clarificationRequired, false);
  assert.equal(response.retrieval.context.selectedChunkCount, 2);
  assert.equal(response.retrieval.context.excludedChunkCount, 0);
  assert.ok(response.retrieval.context.estimatedTokens > 0);
});

/* -------------------------------------------------------------------------- */
/* persistence                                                                 */
/* -------------------------------------------------------------------------- */

test("a completed turn is persisted once with its provenance", async () => {
  const harness = buildPipeline();

  await harness.pipeline.run({
    query: "roadmap review",
    conversationId: CONVERSATION_ID,
    userId: OWNER_USER_ID,
  });

  assert.equal(harness.memory.saves.length, 1, "the turn was saved more than once");
  const [save] = harness.memory.saves;
  assertConversationSaveUserScoped(save, OWNER_USER_ID, CONVERSATION_ID);
  assert.equal(save.userMessage, "roadmap review");
  assert.equal(save.assistantMessage, "Anand shared the roadmap.");

  assert.equal(save.metadata.sourceCount, 2);
  assert.deepEqual(
    [...(save.metadata.sourceType as string[])].sort(),
    ["calendar", "gmail"],
    "the distinct source types are part of the stored provenance",
  );
  assert.equal(save.metadata.clarificationRequired, false);
  assert.equal(save.metadata.streamStatus, "complete");
  assert.equal(save.metadata.llmProvider, "OpenAI");
  assert.ok(save.metadata.retrieval, "retrieval metadata was not stored with the turn");
  assert.ok((save.metadata.retrievalDuration as number) >= 0);
});

test("the persisted turn keeps the original question, not the rewrite", async () => {
  const harness = buildPipeline({
    rewrittenQuery: "roadmap emails from Anand today",
    history: [{ role: "user", content: "emails from Anand" }],
  });

  await harness.pipeline.run({
    query: "and today?",
    conversationId: CONVERSATION_ID,
    userId: OWNER_USER_ID,
  });

  assert.equal(harness.memory.saves[0]?.userMessage, "and today?");
});

test("an empty answer is not persisted", async () => {
  const harness = buildPipeline({ tokens: [] });

  const response = await harness.pipeline.run({
    query: "roadmap review",
    conversationId: CONVERSATION_ID,
    userId: OWNER_USER_ID,
  });

  assert.equal(response.answer, "");
  assert.equal(harness.memory.saves.length, 0);
});

/* -------------------------------------------------------------------------- */
/* clarification                                                               */
/* -------------------------------------------------------------------------- */

test("a clarification answers without generating and is still persisted", async () => {
  const harness = buildPipeline({ outcome: CLARIFICATION_OUTCOME });
  const { stream, statuses, tokens } = collectStream();

  const response = await harness.pipeline.run({
    query: "emails from anand",
    conversationId: CONVERSATION_ID,
    userId: OWNER_USER_ID,
    stream,
  });

  assert.equal(response.clarificationRequired, true);
  assert.equal(response.answer, CLARIFICATION_OUTCOME.clarification?.message);
  assert.deepEqual(response.sources, []);
  assert.equal(response.stopped, false);

  assert.deepEqual(
    statuses.map((status) => status.stage),
    ["query_refinement", "collecting_data", "building_context"],
    "generation must not be announced for a clarification",
  );
  assert.equal(harness.llm.calls.length, 0, "the LLM was called for a clarification");
  assert.deepEqual(tokens, [CLARIFICATION_OUTCOME.clarification?.message]);

  const [save] = harness.memory.saves;
  assertConversationSaveUserScoped(save, OWNER_USER_ID, CONVERSATION_ID);
  assert.equal(save.metadata.clarificationRequired, true);
  assert.equal(save.metadata.clarificationReason, "ambiguous_person");
  assert.equal(save.metadata.sourceCount, 0);
  assert.equal(save.metadata.streamStatus, "complete");
});

/* -------------------------------------------------------------------------- */
/* stop, abort, failure                                                        */
/* -------------------------------------------------------------------------- */

test("a stopped generation is reported and stored as stopped", async () => {
  const harness = buildPipeline({ llmOptions: { stopped: true } });
  const { stream } = collectStream();

  const response = await harness.pipeline.run({
    query: "roadmap review",
    conversationId: CONVERSATION_ID,
    userId: OWNER_USER_ID,
    stream,
  });

  assert.equal(response.stopped, true);
  assert.equal(harness.memory.saves[0]?.metadata.streamStatus, "stopped");
});

test("an abort before retrieval stops the run without persisting", async () => {
  const harness = buildPipeline();
  const controller = new AbortController();
  const { stream } = collectStream();
  controller.abort();

  await assert.rejects(
    () =>
      harness.pipeline.run({
        query: "roadmap review",
        conversationId: CONVERSATION_ID,
        userId: OWNER_USER_ID,
        stream: { ...stream, signal: controller.signal },
      }),
    /query pipeline failed/,
  );

  assert.equal(harness.retriever.calls.length, 0);
  assert.equal(harness.memory.saves.length, 0);
});

test("a generation failure is wrapped and keeps the partial answer", async () => {
  const failure = Object.assign(new Error("provider exploded"), {
    partialAnswer: "Anand sha",
  });
  const harness = buildPipeline({ llmOptions: { failWith: failure } });
  const { stream } = collectStream();

  await assert.rejects(
    () =>
      harness.pipeline.run({
        query: "roadmap review",
        conversationId: CONVERSATION_ID,
        userId: OWNER_USER_ID,
        stream,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "query pipeline failed: provider exploded");
      assert.equal(
        (error as Error & { partialAnswer?: string }).partialAnswer,
        "Anand sha",
      );
      return true;
    },
  );
});

test("the pipeline refuses to run without a query, conversation, or user", async () => {
  const harness = buildPipeline();

  await assert.rejects(
    () =>
      harness.pipeline.run({
        query: "  ",
        conversationId: CONVERSATION_ID,
        userId: OWNER_USER_ID,
      }),
    /Query is missing/,
  );
  await assert.rejects(
    () =>
      harness.pipeline.run({
        query: "roadmap",
        conversationId: "",
        userId: OWNER_USER_ID,
      }),
    /conversation id is missing/,
  );
  await assert.rejects(
    () =>
      harness.pipeline.run({
        query: "roadmap",
        conversationId: CONVERSATION_ID,
        userId: "" as never,
      }),
    /user id is missing/,
  );
});

/* -------------------------------------------------------------------------- */
/* non-streaming path                                                          */
/* -------------------------------------------------------------------------- */

test("without a stream the pipeline uses the non-streaming LLM call", async () => {
  const harness = buildPipeline();

  const response = await harness.pipeline.run({
    query: "roadmap review",
    conversationId: CONVERSATION_ID,
    userId: OWNER_USER_ID,
  });

  assert.equal(harness.llm.calls.length, 1);
  assert.equal(harness.llm.calls[0]?.streamed, false);
  assert.equal(harness.llm.calls[0]?.invocationType, LLM_INVOCATION_TYPES.RAG_CHAT);
  assert.equal(harness.llm.calls[0]?.userId, OWNER_USER_ID);
  assert.equal(response.answer, "Anand shared the roadmap.");
});

test("the generation prompt carries the retrieved context and the question", async () => {
  const harness = buildPipeline({
    history: [{ role: "user", content: "earlier question" }],
  });

  await harness.pipeline.run({
    query: "roadmap review",
    conversationId: CONVERSATION_ID,
    userId: OWNER_USER_ID,
  });

  const messages = harness.llm.calls[0]?.messages ?? [];
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[1]?.content, "earlier question");

  const userMessage = messages.at(-1)?.content ?? "";
  assert.match(userMessage, /Retrieved context:/);
  assert.match(userMessage, /\[Source 1\] gmail 2026-08-01/);
  assert.match(userMessage, /roadmap review$/);
});
