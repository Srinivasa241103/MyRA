// Ad-hoc smoke test for RagChain.chat() — exercises the full default-RAG path
// wired into chatController (retrieval -> context -> memory -> LLM -> save).
// Run: node test/test-ragchain-e2e.js

import dotenv from "dotenv";
dotenv.config();

import { connectToDB } from "../src/config/dbConfig.js";
import RagChain from "../src/RAG/ragService.js";
import { v4 as uuidv4 } from "uuid";

async function run() {
  await connectToDB();

  const ragChain = new RagChain();
  const userId = Number(process.env.SYNC_USER_ID) || 3;
  const conversationId = uuidv4();

  console.log(`\nTesting RagChain.chat() with userId=${userId}, conversationId=${conversationId}\n`);

  const result = await ragChain.chat({
    userMessage: "What was in the mail sent by Ravikumar Guntu?",
    conversationId,
    userId,
    llmProvider: "OpenAI",
  });

  console.log("Result:", JSON.stringify(result, null, 2));

  process.exit(result.success ? 0 : 1);
}

run().catch((err) => {
  console.error("Uncaught error:", err);
  process.exit(1);
});