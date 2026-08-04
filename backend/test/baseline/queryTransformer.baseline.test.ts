/**
 * FND-06 — query transformation baseline.
 *
 * Rewriting a follow-up into a standalone query is the first thing that runs on
 * every chat turn, and it is the cheapest place to break retrieval silently: a
 * rewrite that drops the person or the timeframe still "works", it just answers
 * a different question. This suite freezes:
 *   1. Which queries are rewritten at all (the LLM is never called otherwise).
 *   2. That the original query survives every failure mode.
 *   3. That rewrites are billed to the caller's user and conversation under the
 *      query_rewrite invocation type.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  QueryTransformer,
  isContextDependentQuery,
} from "../../src/RAG/retrieval/queryTransformer.js";
import { LLM_INVOCATION_TYPES } from "../../src/utils/constants.js";

import {
  CONVERSATION_ID,
  OWNER_USER_ID,
  StructuredLLMDouble,
} from "../fixtures/fnd06-baseline-fixtures.js";

const HISTORY = [
  { role: "user", content: "Show me emails from Anand about the roadmap" },
  { role: "assistant", content: "Anand sent two roadmap emails last week." },
];

function buildTransformer(
  response: unknown,
  failure: Error | null = null,
): { transformer: QueryTransformer; llm: StructuredLLMDouble } {
  const llm = new StructuredLLMDouble(response, failure);
  const transformer = new QueryTransformer({ llmService: llm as never });
  return { transformer, llm };
}

const BASE_INPUT = {
  userId: OWNER_USER_ID,
  conversationId: CONVERSATION_ID,
  llmProvider: "OpenAI",
  model: null,
};

/* -------------------------------------------------------------------------- */
/* when the rewrite is skipped                                                 */
/* -------------------------------------------------------------------------- */

test("rewriting disabled returns the original query untouched", async () => {
  const { transformer, llm } = buildTransformer({ standaloneQuery: "rewritten" });

  const result = await transformer.transform({
    ...BASE_INPUT,
    query: "what about today?",
    history: HISTORY,
    enabled: false,
  });

  assert.deepEqual(result, {
    originalQuery: "what about today?",
    query: "what about today?",
    rewritten: false,
    attempted: false,
    reason: "disabled",
  });
  assert.equal(llm.calls.length, 0, "a disabled rewrite still called the LLM");
});

test("the first turn of a conversation is never rewritten", async () => {
  const { transformer, llm } = buildTransformer({ standaloneQuery: "rewritten" });

  const result = await transformer.transform({
    ...BASE_INPUT,
    query: "what about today?",
    history: [],
  });

  assert.equal(result.reason, "no_history");
  assert.equal(result.query, "what about today?");
  assert.equal(llm.calls.length, 0);
});

test("a self-contained query skips the rewrite call", async () => {
  const { transformer, llm } = buildTransformer({ standaloneQuery: "rewritten" });

  const result = await transformer.transform({
    ...BASE_INPUT,
    query: "Show me the invoice from Stripe in July",
    history: HISTORY,
  });

  assert.equal(result.reason, "standalone");
  assert.equal(result.rewritten, false);
  assert.equal(result.query, "Show me the invoice from Stripe in July");
  assert.equal(llm.calls.length, 0);
});

/* -------------------------------------------------------------------------- */
/* follow-up detection                                                         */
/* -------------------------------------------------------------------------- */

test("follow-up detection classifies the shapes the rewrite depends on", () => {
  for (const query of [
    "and today?",
    "what about last week",
    "which one did he send",
    "show me that email",
    "the latest ones",
    "latest",
  ]) {
    assert.ok(isContextDependentQuery(query), `expected "${query}" to be context dependent`);
  }

  for (const query of [
    "Show me the invoice from Stripe in July",
    "meetings with Priya tomorrow",
    "",
  ]) {
    assert.equal(
      isContextDependentQuery(query),
      false,
      `expected "${query}" to be standalone`,
    );
  }
});

/* -------------------------------------------------------------------------- */
/* the rewrite itself                                                          */
/* -------------------------------------------------------------------------- */

test("a follow-up is rewritten into a standalone query", async () => {
  const { transformer, llm } = buildTransformer({
    standaloneQuery: "  Emails from Anand   about the roadmap today ",
  });

  const result = await transformer.transform({
    ...BASE_INPUT,
    query: "and today?",
    history: HISTORY,
  });

  assert.deepEqual(result, {
    originalQuery: "and today?",
    query: "Emails from Anand about the roadmap today",
    rewritten: true,
    attempted: true,
    reason: "context_dependent",
  });

  const [call] = llm.calls;
  assert.equal(call?.invocationType, LLM_INVOCATION_TYPES.QUERY_REWRITE);
  assert.equal(call?.userId, OWNER_USER_ID);
  assert.equal(call?.conversationId, CONVERSATION_ID);
  assert.match(call?.messages[1]?.content ?? "", /Anand sent two roadmap emails last week/);
  assert.match(call?.messages[1]?.content ?? "", /Follow-up query:\nand today\?/);
});

test("a rewrite that returns the same text is not reported as a rewrite", async () => {
  const { transformer } = buildTransformer({ standaloneQuery: "And Today?" });

  const result = await transformer.transform({
    ...BASE_INPUT,
    query: "and today?",
    history: HISTORY,
  });

  assert.equal(result.rewritten, false);
  assert.equal(result.attempted, true);
  assert.equal(result.reason, "context_dependent");
  assert.equal(result.query, "and today?");
});

test("a failed rewrite degrades to the original query and records why", async () => {
  const { transformer } = buildTransformer(null, new Error("provider timeout"));

  const result = await transformer.transform({
    ...BASE_INPUT,
    query: "and today?",
    history: HISTORY,
  });

  assert.equal(result.reason, "rewrite_failed");
  assert.equal(result.attempted, true);
  assert.equal(result.rewritten, false);
  assert.equal(result.query, "and today?");
  assert.equal(result.error, "provider timeout");
});

test("whitespace is normalized before anything else looks at the query", async () => {
  const { transformer } = buildTransformer({ standaloneQuery: "rewritten" });

  const result = await transformer.transform({
    ...BASE_INPUT,
    query: "   Show me   the  invoice \n from Stripe   ",
    history: HISTORY,
  });

  assert.equal(result.originalQuery, "Show me the invoice from Stripe");
});

test("an empty query is rejected rather than sent downstream", async () => {
  const { transformer } = buildTransformer({ standaloneQuery: "rewritten" });

  await assert.rejects(
    () => transformer.transform({ ...BASE_INPUT, query: "   ", history: HISTORY }),
    /requires a non-empty query/,
  );
});

test("only the last six history messages are sent to the rewriter", async () => {
  const { transformer, llm } = buildTransformer({ standaloneQuery: "rewritten query" });
  const longHistory = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message-${index}`,
  }));

  await transformer.transform({
    ...BASE_INPUT,
    query: "and today?",
    history: longHistory,
  });

  const prompt = llm.calls[0]?.messages[1]?.content ?? "";
  assert.ok(prompt.includes("message-9"), "the most recent turn was dropped");
  assert.ok(!prompt.includes("message-3"), "history was not truncated to six messages");
});
