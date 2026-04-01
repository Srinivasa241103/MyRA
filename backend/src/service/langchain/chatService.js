import ragChain from "./chain.js";
import LangChainMemoryService from "./memory.js";
import { logger } from "../../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

class LangChainChatService {
  constructor() {
    this.memory = new LangChainMemoryService();
  }

  async chat(userMessage, conversationId = null, options = {}) {
    try {
      if (!conversationId) {
        conversationId = uuidv4();
        logger.info("Created new conversation", { conversationId });
      }

      logger.info("Chat request", {
        conversationId,
        messageLength: userMessage.length,
      });

      const response = await ragChain.query(userMessage, conversationId, options);

      return {
        success: true,
        conversationId,
        response: response.answer,
        sourceDocuments: response.sourceDocuments.map((doc) => ({
          content: doc.pageContent,
          source: doc.metadata.source,
          type: doc.metadata.type,
          metadata: doc.metadata,
        })),
        duration: response.duration,
      };
    } catch (error) {
      logger.error("Error in chat", { error: error.message });
      return {
        success: false,
        error: error.message,
        conversationId,
      };
    }
  }

  async *chatStream(userMessage, conversationId = null, options = {}) {
    try {
      if (!conversationId) {
        conversationId = uuidv4();
      }

      for await (const chunk of ragChain.queryStream(
        userMessage,
        conversationId,
        options
      )) {
        yield chunk;
      }
    } catch (error) {
      logger.error("Error in streaming chat", { error: error.message });
      yield { type: "error", data: { error: error.message } };
    }
  }

  async getHistory(conversationId) {
    try {
      return await this.memory.loadHistory(conversationId);
    } catch (error) {
      logger.error("Error getting history", { error: error.message });
      return [];
    }
  }

  async clearConversation(conversationId) {
    try {
      await this.memory.clearConversation(conversationId);
      logger.info("Conversation cleared", { conversationId });
    } catch (error) {
      logger.error("Error clearing conversation", { error: error.message });
      throw error;
    }
  }

  async getConversationSummary(conversationId) {
    try {
      return await this.memory.getConversationHistory(conversationId);
    } catch (error) {
      logger.error("Error getting conversation summary", {
        error: error.message,
      });
      throw error;
    }
  }
}

export default new LangChainChatService();
