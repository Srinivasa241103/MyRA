/**
 * Manual test script for LLM usage tracking.
 * Run: node --env-file=.env src/service/langchain/test-usage-tracking.js
 */

import { usdToInr } from "../../utils/exchanceRates.js";
import { StatsRepository } from "../../database/index.js";
import LangChainLLMService from "./llm.js";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// ─── Test 1: usdToInr returns a valid exchange rate ──────────────────────────
async function testExchangeRate() {
  console.log("\nTest 1: usdToInr()");
  try {
    const rate = await usdToInr();
    assert(typeof rate === "number", `returns a number (got ${rate})`);
    assert(rate > 50 && rate < 200, `rate is in realistic range (got ${rate})`);
  } catch (err) {
    console.error(`  ✗ threw error: ${err.message}`);
    failed++;
  }
}

// ─── Test 2: StatsRepository.insertLLMPrice saves without error ──────────────
async function testStatsRepository() {
  console.log("\nTest 2: StatsRepository.insertLLMPrice()");
  const repo = new StatsRepository();
  const testStats = {
    conversationId: "test-conv-" + Date.now(),
    provider: "Anthropic",
    model: "claude-haiku-4-5-20251001",
    inputTokens: 100,
    outputTokens: 50,
    inputCost: 0.008,
    outputCost: 0.021,
    invocationType: "chat",
  };

  try {
    await repo.insertLLMPrice(testStats);
    assert(true, "insert completed without throwing");
  } catch (err) {
    assert(false, `insert threw: ${err.message}`);
  }
}

// ─── Test 3: generateResponse returns text and logs usage ────────────────────
async function testGenerateResponse() {
  console.log("\nTest 3: LangChainLLMService.generateResponse()");
  const llm = new LangChainLLMService();
  const conversationId = "test-usage-" + Date.now();

  try {
    const result = await llm.generateResponse(
      "Reply with exactly: USAGE_TEST_OK",
      conversationId
    );

    assert(typeof result.text === "string" && result.text.length > 0, "result.text is a non-empty string");
    assert(typeof result.duration === "number" && result.duration > 0, `result.duration is positive (${result.duration}ms)`);
    assert(result.model !== undefined, `result.model is set (${result.model})`);
    assert(result.tokensUsed?.total > 0, `tokensUsed.total > 0 (${result.tokensUsed?.total})`);
    console.log(`  ℹ  Response: "${result.text.trim().substring(0, 60)}"`);
    console.log(`  ℹ  Tokens — input: ${result.tokensUsed.prompt}, output: ${result.tokensUsed.response}`);
  } catch (err) {
    assert(false, `threw error: ${err.message}`);
    console.error(err.stack);
  }
}

// ─── Runner ──────────────────────────────────────────────────────────────────
async function run() {
  console.log("=== LLM Usage Tracking Tests ===");

  await testExchangeRate();
  await testStatsRepository();
  await testGenerateResponse();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
