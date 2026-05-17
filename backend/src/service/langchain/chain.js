import LangChainLLMService from "./llm.js";
import vectorStore from "./vectorStore.js";
import LangChainMemoryService from "./memory.js";
import { QA_PROMPT } from "./prompts.js";
import { logger } from "../../utils/logger.js";

class RAGChainService {
  constructor() {
    this.initialized = false;
    this.llm = new LangChainLLMService();
    this.memory = new LangChainMemoryService();
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      logger.info("Initializing RAG Chain...");
      await vectorStore.initialize();
      this.initialized = true;
      logger.info("RAG Chain initialized successfully");
    } catch (error) {
      logger.error("Error initializing RAG Chain", error);
      throw error;
    }
  }

  async query(question, conversationId, options = {}) {
    try {
      logger.info("RAG query", {
        question: question.substring(0, 100),
        conversationId,
      });

      const startTime = Date.now();

      await this.initialize();

      const retriever = vectorStore.asRetriever(
        options.k || 10,
        options.filter || null
      );

      const sourceDocuments = await retriever.invoke(question);
      const context = sourceDocuments
        .map((doc) => doc.pageContent)
        .join("\n\n---\n\n");

      const history = await this.memory.loadHistory(conversationId);
      const chatHistory = history
        .slice(-10)
        .map((msg) => `${msg.role}: ${msg.content}`)
        .join("\n");

      const formattedPrompt = await QA_PROMPT.format({
        context,
        chat_history: chatHistory,
        question,
      });
      const llmResult = await this.llm.generateResponse(
        formattedPrompt,
        conversationId
      );
      const answer = llmResult.text;

      const duration = Date.now() - startTime;

      await this.memory.saveConversation(conversationId, question, answer, {
        sourceDocuments: sourceDocuments.length,
        duration,
      });

      logger.info("RAG query completed", {
        duration: `${duration}ms`,
        sourcesUsed: sourceDocuments.length,
      });

      return {
        answer,
        sourceDocuments,
        conversationId,
        duration,
      };
    } catch (error) {
      logger.error("Error in RAG query", error);
      throw error;
    }
  }

  async *queryStream(question, conversationId, options = {}) {
    try {
      logger.info("RAG streaming query", { conversationId });

      await this.initialize();

      const retriever = vectorStore.asRetriever(
        options.k || 10,
        options.filter || null
      );

      const retrievedDocs = await retriever.invoke(question);

      yield {
        type: "context",
        data: {
          documentsFound: retrievedDocs.length,
          sources: retrievedDocs.map((d) => ({
            source: d.metadata.source,
            type: d.metadata.type,
          })),
        },
      };

      const context = retrievedDocs
        .map((doc) => doc.pageContent)
        .join("\n\n---\n\n");

      const history = await this.memory.loadHistory(conversationId);
      const chatHistory = history
        .slice(-10)
        .map((msg) => `${msg.role}: ${msg.content}`)
        .join("\n");

      const prompt = await QA_PROMPT.format({
        context,
        chat_history: chatHistory,
        question,
      });

      let fullAnswer = "";
      for await (const chunk of this.llm.generateStreamingResponse(prompt)) {
        fullAnswer += chunk;
        yield { type: "text", data: chunk };
      }

      await this.memory.saveConversation(conversationId, question, fullAnswer, {
        sourceDocuments: retrievedDocs.length,
      });

      yield {
        type: "done",
        data: { sourceDocuments: retrievedDocs, conversationId },
      };
    } catch (error) {
      logger.error("Error in streaming RAG query", error);
      yield { type: "error", data: { error: error.message } };
    }
  }

  async healthCheck() {
    try {
      await this.initialize();
      return true;
    } catch (error) {
      return false;
    }
  }
}

export default new RAGChainService();
