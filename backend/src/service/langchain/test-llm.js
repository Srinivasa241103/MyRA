import "dotenv/config";
import LangChainLLMService from "./llm.js";

const llm = new LangChainLLMService();

function pass(label) { console.log(`  ✅ ${label}`); }
function fail(label, err) { console.log(`  ❌ ${label}: ${err}`); }
function section(title) {
  console.log(`\n${"─".repeat(55)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(55));
}

async function runTests() {
  console.log("\n🧪  Claude LLM Service — Test Suite");

  let passed = 0;
  let failed = 0;

  // ── Test 1: Basic response ────────────────────────────────
  section("Test 1: Basic single-turn response");
  try {
    const res = await llm.generateResponse("What is 2 + 2? Answer in one word.");
    console.log("  Response:", res.text);
    if (typeof res.text === "string" && res.text.length > 0) pass("Returns non-empty text");
    else fail("Returns non-empty text", "empty string");
    if (res.model) pass(`Model reported: ${res.model}`);
    if (typeof res.duration === "number") pass(`Duration: ${res.duration}ms`);
    if (res.tokensUsed?.total > 0) pass(`Token estimate: ${res.tokensUsed.total}`);
    passed++;
  } catch (e) {
    fail("Basic response", e.message);
    failed++;
  }

  // ── Test 2: System prompt ─────────────────────────────────
  section("Test 2: System prompt respected");
  try {
    const res = await llm.generateResponse("What is your name?", {
      systemPrompt: "You are a helpful assistant named Atlas. Always introduce yourself as Atlas.",
    });
    console.log("  Response:", res.text);
    if (res.text.toLowerCase().includes("atlas")) pass("System prompt applied — name 'Atlas' found");
    else fail("System prompt applied", `'Atlas' not in: ${res.text}`);
    passed++;
  } catch (e) {
    fail("System prompt", e.message);
    failed++;
  }

  // ── Test 3: Conversation history ──────────────────────────
  section("Test 3: Conversation history / memory");
  try {
    const history = [
      { role: "user",      content: "My favourite colour is indigo." },
      { role: "assistant", content: "Got it! Indigo is a beautiful deep blue-purple." },
    ];
    const res = await llm.generateResponse("What is my favourite colour?", {
      conversationHistory: history,
    });
    console.log("  Response:", res.text);
    if (res.text.toLowerCase().includes("indigo")) pass("Recalled colour from history");
    else fail("Recalled colour from history", `'indigo' not in: ${res.text}`);
    passed++;
  } catch (e) {
    fail("Conversation history", e.message);
    failed++;
  }

  // ── Test 4: chat() helper ─────────────────────────────────
  section("Test 4: chat() helper updates history");
  try {
    const res = await llm.chat("Say exactly: hello world", []);
    console.log("  Response:", res.text);
    if (res.conversationHistory.length === 2) pass("History has 2 entries (user + assistant)");
    else fail("History length", `got ${res.conversationHistory.length}`);
    if (res.conversationHistory[0].role === "user") pass("First entry is user");
    if (res.conversationHistory[1].role === "assistant") pass("Second entry is assistant");
    passed++;
  } catch (e) {
    fail("chat() helper", e.message);
    failed++;
  }

  // ── Test 5: Streaming ─────────────────────────────────────
  section("Test 5: Streaming response");
  try {
    let chunks = 0;
    let fullText = "";
    process.stdout.write("  Stream: ");
    for await (const chunk of llm.generateStreamingResponse("Count from 1 to 5.")) {
      process.stdout.write(chunk);
      fullText += chunk;
      chunks++;
    }
    console.log();
    if (chunks > 1) pass(`Received ${chunks} chunks`);
    else fail("Multiple chunks", `only got ${chunks}`);
    if (fullText.length > 0) pass("Stream assembled non-empty text");
    passed++;
  } catch (e) {
    fail("Streaming", e.message);
    failed++;
  }

  // ── Test 6: Health check ──────────────────────────────────
  section("Test 6: healthCheck()");
  try {
    const healthy = await llm.healthCheck();
    if (healthy) pass("healthCheck() returned true");
    else fail("healthCheck()", "returned false");
    passed++;
  } catch (e) {
    fail("healthCheck()", e.message);
    failed++;
  }

  // ── Test 7: Empty / edge input ────────────────────────────
  section("Test 7: Edge case — very short prompt");
  try {
    const res = await llm.generateResponse("Hi");
    if (res.text.length > 0) pass("Handles minimal prompt without error");
    passed++;
  } catch (e) {
    fail("Edge case prompt", e.message);
    failed++;
  }

  // ── Summary ───────────────────────────────────────────────
  console.log(`\n${"═".repeat(55)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(55) + "\n");

  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error("\n💥 Unexpected error:", e.message);
  process.exit(1);
});
