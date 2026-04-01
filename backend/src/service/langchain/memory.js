import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import ConversationRepository from "../../database/conversationsRepo.js";
import { logger } from "../../utils/logger.js";

export default class LangChainMemoryService {
  constructor() {
    this.conversationRepo = new ConversationRepository();
  }

  async createMemory(conversationId, maxMessages = 10) {
    try {
      logger.info("Creating memory for conversation", { conversationId });

      // Load conversation history from database
      const history = await this.loadHistory(conversationId);

      const chatHistory = new InMemoryChatMessageHistory();

      for (const msg of history) {
        if (msg.role === "user") {
          await chatHistory.addMessage(new HumanMessage(msg.content));
        } else if (msg.role === "assistant") {
          await chatHistory.addMessage(new AIMessage(msg.content));
        }
      }

      return chatHistory;
    } catch (error) {
      logger.error("Error creating memory", { error: error.message });
      throw error;
    }
  }

  async loadHistory(conversationId) {
    try {
      const result = await this.conversationRepo.getConversationHistory(
        conversationId
      );

      const messages = [];
      for (const row of result.rows) {
        messages.push(
          { role: "user", content: row.user_message },
          { role: "assistant", content: row.assistant_message }
        );
      }

      logger.info("Loaded conversation history", {
        conversationId,
        messageCount: messages.length,
      });
      return messages;
    } catch (error) {
      logger.error("Error loading conversation history", {
        conversationId,
        error: error.message,
      });
      return [];
    }
  }

  async saveConversation(
    conversationId,
    userMessage,
    assistantMessage,
    metadata = {}
  ) {
    try {
      const conversationObject = {
        conversation_id: conversationId,
        user_message: userMessage,
        assistant_message: assistantMessage,
        metadata: JSON.stringify(metadata),
      };
      await this.conversationRepo.saveChatConversation(conversationObject);

      logger.info("Saved conversation to database", { conversationId });
    } catch (error) {
      logger.error("Error saving conversation", {
        conversationId,
        error: error.message,
      });
      throw error;
    }
  }

  async getConversationHistory(conversationId) {
    try {
      const result = this.conversationRepo.getHistory(conversationId);
      return result;
    } catch (error) {
      logger.error("Error getting conversation summary", {
        error: error.message,
      });
      throw error;
    }
  }

  async clearConversation(conversationId) {
    try {
      await this.conversationRepo.clear(conversationId);
      logger.info("Conversation cleared", { conversationId });
    } catch (error) {
      logger.error("Error clearing conversation", {
        conversationId,
        error: error.message,
      });
      throw error;
    }
  }
}
