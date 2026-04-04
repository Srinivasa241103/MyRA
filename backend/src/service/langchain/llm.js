import { ChatAnthropic } from "@langchain/anthropic";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
} from "@langchain/core/messages";
import { logger } from "../../utils/logger.js";

/**
 * LangChain wrapper for Claude (Anthropic) LLM
 * Replaces Gemini for LLM (keeping Gemini for embeddings)
 */
export default class LangChainLLMService {
  constructor() {
    this.model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022",
      temperature: parseFloat(process.env.CLAUDE_TEMPERATURE || "0.7"),
      maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || "4096"),
      maxRetries: 2,
      timeout: 30000,
      streaming: false,
    });

    logger.info("LangChain LLM Service initialized (Claude)", {
      model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022",
      temperature: parseFloat(process.env.CLAUDE_TEMPERATURE || "0.7"),
    });
  }

  /**
   * Generate a response using Claude
   * @param {string} prompt - User prompt or question
   * @param {Object} options - Generation options
   * @param {string} options.systemPrompt - System instruction
   * @param {Array} options.conversationHistory - Previous messages
   * @returns {Promise<Object>} - Generated response
   */
  async generateResponse(prompt, options = {}) {
    try {
      const startTime = Date.now();

      logger.info("Generating LLM response (Claude)", {
        promptLength: prompt.length,
        hasSystemPrompt: !!options.systemPrompt,
        historyLength: options.conversationHistory?.length || 0,
      });

      const messages = this._buildMessages(prompt, options);
      const response = await this.model.invoke(messages);
      const duration = Date.now() - startTime;

      logger.info("LLM response generated (Claude)", {
        duration: `${duration}ms`,
        responseLength: response.content.length,
      });

      return {
        text: response.content,
        duration,
        model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022",
        tokensUsed: this._estimateTokens(prompt, response.content),
      };
    } catch (error) {
      logger.error("Error generating LLM response (Claude)", {
        error: error.message,
        promptPreview: prompt.substring(0, 100),
      });
      throw new Error(`Claude LLM error: ${error.message}`);
    }
  }

  /**
   * Generate streaming response
   * @param {string} prompt - User prompt
   * @param {Object} options - Generation options
   * @returns {AsyncGenerator} - Streaming response chunks
   */
  async *generateStreamingResponse(prompt, options = {}) {
    try {
      logger.info("Generating streaming response (Claude)", {
        promptLength: prompt.length,
      });

      const messages = this._buildMessages(prompt, options);

      const streamingModel = new ChatAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022",
        temperature: parseFloat(process.env.CLAUDE_TEMPERATURE || "0.7"),
        maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || "4096"),
        streaming: true,
      });

      const stream = await streamingModel.stream(messages);

      for await (const chunk of stream) {
        if (chunk.content) {
          yield chunk.content;
        }
      }

      logger.info("Streaming response completed (Claude)");
    } catch (error) {
      logger.error("Error generating streaming response (Claude)", {
        error: error.message,
      });
      throw new Error(`Claude streaming error: ${error.message}`);
    }
  }

  /**
   * Chat with conversation history
   * @param {string} userMessage - Current user message
   * @param {Array} conversationHistory - Previous messages
   * @param {string} systemPrompt - System instruction
   * @returns {Promise<Object>} - Response with updated history
   */
  async chat(userMessage, conversationHistory = [], systemPrompt = null) {
    try {
      logger.info("Chat invocation (Claude)", {
        messageLength: userMessage.length,
        historyLength: conversationHistory.length,
      });

      const response = await this.generateResponse(userMessage, {
        systemPrompt,
        conversationHistory,
      });

      const updatedHistory = [
        ...conversationHistory,
        { role: "user", content: userMessage },
        { role: "assistant", content: response.text },
      ];

      return {
        ...response,
        conversationHistory: updatedHistory,
      };
    } catch (error) {
      logger.error("Error in chat (Claude)", { error: error.message });
      throw error;
    }
  }

  /**
   * Build message array for Claude
   * @private
   */
  _buildMessages(prompt, options) {
    const messages = [];

    if (options.systemPrompt) {
      messages.push(new SystemMessage(options.systemPrompt));
    }

    if (options.conversationHistory?.length > 0) {
      for (const msg of options.conversationHistory) {
        if (msg.role === "user") {
          messages.push(new HumanMessage(msg.content));
        } else if (msg.role === "assistant" || msg.role === "ai") {
          messages.push(new AIMessage(msg.content));
        } else if (msg.role === "system") {
          messages.push(new SystemMessage(msg.content));
        }
      }
    }

    messages.push(new HumanMessage(prompt));

    return messages;
  }

  /**
   * Estimate token usage (rough calculation)
   * @private
   */
  _estimateTokens(prompt, response) {
    const promptTokens = Math.ceil(prompt.length / 4);
    const responseTokens = Math.ceil(response.length / 4);
    return {
      prompt: promptTokens,
      response: responseTokens,
      total: promptTokens + responseTokens,
    };
  }

  /**
   * Health check
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      const response = await this.generateResponse(
        "Say 'OK' if you're working"
      );
      return response.text.length > 0;
    } catch (error) {
      logger.error("LLM health check failed (Claude)", {
        error: error.message,
      });
      return false;
    }
  }
}
