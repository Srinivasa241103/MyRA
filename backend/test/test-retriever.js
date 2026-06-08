// test/test-retriever.js
// Tests Retriever.retrieve() and buildContext() against the live vector store.
// Run: node test/test-retriever.js

import dotenv from "dotenv";
dotenv.config();

import { connectToDB } from "../src/config/dbConfig.js";
import Retriever from "../src/RAG/retrieval/retriever.js";
import { buildContext } from "../src/RAG/retrieval/contextBuilder.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${"─".repeat(55)}`);
  console.log(`  ${title}`);
  console.log(`${"─".repeat(55)}`);
}

// ─── Test data ───────────────────────────────────────────────────────────────

const QUERY = "What was in the mail recieved my ravikumar guntu";
const USER_ID = Number(process.env.SYNC_USER_ID) || 3;

// ─── Run ─────────────────────────────────────────────────────────────────────

async function run() {
  await connectToDB();

  section("Retriever.retrieve()");

  const retriever = new Retriever();
  let chunks = [];
  try {
    chunks = await retriever.retrieve(QUERY, USER_ID, { topK: 5 });
    assert(Array.isArray(chunks), "retrieve() resolves with an array");
    console.log(`  Retrieved ${chunks.length} chunk(s) for query: "${QUERY}"`);
    chunks.forEach((chunk, i) => {
      console.log(
        `    [${i + 1}] distance=${chunk.distance?.toFixed?.(4)} source_type=${chunk.source_type} content="${chunk.content?.slice(0, 80)}..."`,
      );
    });
  } catch (error) {
    assert(false, `retrieve() threw: ${error.message}`);
  }

  section("buildContext()");

  try {
    const context = buildContext(chunks);
    assert(typeof context === "string", "buildContext() returns a string");
    assert(context.startsWith("Retrieved context:"), "context starts with 'Retrieved context:'");
    console.log("\n--- Built context ---\n");
    console.log(context);
    console.log("\n---------------------\n");
  } catch (error) {
    assert(false, `buildContext() threw: ${error.message}`);
  }

  section("Summary");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

run();
