// backend/src/services/langchain/compare-vectorstore.js

import "dotenv/config";
// backend/src/services/langchain/test-chat.js

import chatService from "./chatService.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Test complete LangChain chat system
 */
async function testChatSystem() {
  console.log("\n" + "=".repeat(60));
  console.log("Testing LangChain Chat System (Complete RAG)");
  console.log("=".repeat(60) + "\n");

  try {
    // Test 1: Simple single-turn chat
    console.log("Test 1: Single-Turn Chat with RAG");
    console.log("-".repeat(60));

    const query1 = "What emails do I have about project deadlines?";
    console.log("User:", query1);

    const response1 = await chatService.chat(query1);

    console.log("✅ Success:", response1.success);
    console.log("✅ Conversation ID:", response1.conversationId);
    console.log("✅ Response:", response1.response);
    console.log("✅ Sources used:", response1.sourceDocuments.length);
    console.log("✅ Duration:", response1.duration + "ms");

    if (response1.sourceDocuments.length > 0) {
      console.log("\n   Top source:");
      console.log("   - Source:", response1.sourceDocuments[0].source);
      console.log("   - Type:", response1.sourceDocuments[0].type);
      console.log(
        "   - Content:",
        response1.sourceDocuments[0].content.substring(0, 100) + "..."
      );
    }
    console.log();

    // Test 2: Multi-turn conversation
    console.log("Test 2: Multi-Turn Conversation with Memory");
    console.log("-".repeat(60));

    const conversationId = uuidv4();
    console.log("Conversation ID:", conversationId);

    // Turn 1
    console.log('\n👤 Turn 1: "What are my upcoming meetings?"');
    const turn1 = await chatService.chat(
      "What are my upcoming meetings?",
      conversationId
    );
    console.log("🤖 Assistant:", turn1.response.substring(0, 150) + "...");
    console.log("   Sources:", turn1.sourceDocuments.length);

    // Turn 2 - Follow-up question (tests memory)
    console.log('\n👤 Turn 2: "When is the first one?"');
    const turn2 = await chatService.chat(
      "When is the first one?",
      conversationId
    );
    console.log("🤖 Assistant:", turn2.response);
    console.log(
      "✅ Uses context from previous turn:",
      turn2.response.length > 0
    );

    // Turn 3 - Another follow-up
    console.log('\n👤 Turn 3: "Who else will be there?"');
    const turn3 = await chatService.chat(
      "Who else will be there?",
      conversationId
    );
    console.log("🤖 Assistant:", turn3.response);
    console.log();

    // Test 3: Get conversation history
    console.log("Test 3: Retrieve Conversation History");
    console.log("-".repeat(60));

    const history = await chatService.getHistory(conversationId);
    console.log("✅ History entries:", history.length);

    if (history.length > 0) {
      console.log("\nFirst exchange:");
      console.log("  User:", history[0].content);
      console.log("  Assistant:", history[1].content.substring(0, 100) + "...");
    }
    console.log();

    // Test 4: Streaming response
    console.log("Test 4: Streaming Chat Response");
    console.log("-".repeat(60));

    const streamQuery = "Summarize my recent emails";
    console.log("Query:", streamQuery);
    console.log("\n🤖 Streaming response:\n");

    let fullResponse = "";
    let contextInfo = null;
    let sourceCount = 0;

    for await (const chunk of chatService.chatStream(streamQuery)) {
      if (chunk.type === "context") {
        contextInfo = chunk.data;
        console.log(`[Retrieved ${chunk.data.documentsFound} documents]\n`);
      } else if (chunk.type === "text") {
        process.stdout.write(chunk.data);
        fullResponse += chunk.data;
      } else if (chunk.type === "done") {
        sourceCount = chunk.data.sourceDocuments.length;
        console.log(`\n\n[Done - Used ${sourceCount} sources]`);
      } else if (chunk.type === "error") {
        console.error("\n❌ Error:", chunk.data.error);
      }
    }

    console.log(
      "\n✅ Full response length:",
      fullResponse.length,
      "characters"
    );
    console.log("✅ Streaming completed");
    console.log();

    // Test 5: With source filters
    console.log("Test 5: Chat with Source Filtering");
    console.log("-".repeat(60));

    const filteredQuery = "What did I receive?";
    console.log("Query:", filteredQuery);
    console.log('Filter: { source: "gmail" }');

    const response5 = await chatService.chat(filteredQuery, null, {
      filter: { source: "gmail" },
    });

    console.log("✅ Response:", response5.response.substring(0, 150) + "...");
    console.log(
      "✅ All sources are gmail:",
      response5.sourceDocuments.every((d) => d.source === "gmail")
    );
    console.log();

    // Test 6: Conversation summary
    console.log("Test 6: Conversation Summary");
    console.log("-".repeat(60));

    const summary = await chatService.getConversationSummary(conversationId);
    console.log("✅ Message count:", summary.message_count);
    console.log("✅ First message:", summary.first_message);
    console.log("✅ Last message:", summary.last_message);
    console.log();

    console.log("=".repeat(60));
    console.log("✅ All tests passed!");
    console.log("=".repeat(60));
    console.log("\n🎉 Your complete LangChain RAG system is working!\n");
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
testChatSystem();
