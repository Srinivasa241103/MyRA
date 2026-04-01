import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
} from "@langchain/core/messages";
import { logger } from "../../utils/logger.js";

/**
 * LangChain wrapper for Gemini Pro LLM
 * Replaces existing GeminiService.js
 */

export default class LangChainLLMService {
  constructor() {
    this._model = null;
  }

  get model() {
    if (!this._model) {
      this._model = new ChatGoogleGenerativeAI({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_CHAT_MODEL || "gemini-2.0-flash",
        temperature: parseFloat(process.env.GEMINI_TEMPERATURE || "0.7"),
        maxOutputTokens: parseInt(
          process.env.GEMINI_MAX_OUTPUT_TOKENS || "2048"
        ),
        streaming: false,
        thinkingConfig: { thinkingBudget: 0 },
      });
      logger.info("LangChain LLM Service initialized", {
        model: process.env.GEMINI_CHAT_MODEL || "gemini-2.0-flash",
        temperature: parseFloat(process.env.GEMINI_TEMPERATURE || "0.7"),
      });
    }
    return this._model;
  }

  /**
   * Generate a response using Gemini Pro
   * @param {string} prompt - User prompt or question
   * @param {Object} options - Generation options
   * @param {string} options.systemPrompt - System instruction
   * @param {Array} options.conversationHistory - Previous messages
   * @returns {Promise<Object>} - Generated response
   */
  async generateResponse(prompt, options = {}) {
    try {
      const startTime = Date.now();

      logger.info("Generating LLM response", {
        promptLength: prompt.length,
        hasSystemPrompt: !!options.systemPrompt,
        historyLength: options.conversationHistory?.length || 0,
      });

      const messages = this._buildMessages(prompt, options);

      const response = await this.model.invoke(messages);

      const duration = Date.now() - startTime;

      logger.info("LLM response generated", {
        duration: `${duration}ms`,
        responseLength: response.content.length,
      });

      return {
        text: response.content,
        duration,
        model: process.env.GEMINI_CHAT_MODEL || "gemini-2.0-flash",
        tokensUsed: this._estimateTokens(prompt, response.content),
      };
    } catch (error) {
      logger.error("Error generating LLM response", {
        error: error.message,
        promptPreview: prompt.substring(0, 100),
      });
      throw new Error(`Gemini LLM error: ${error.message}`);
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
      logger.info("Generating streaming response", {
        promptLength: prompt.length,
      });

      // Build messages
      const messages = this._buildMessages(prompt, options);

      // Create streaming model instance
      const streamingModel = new ChatGoogleGenerativeAI({
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_CHAT_MODEL || "gemini-2.0-flash",
        temperature: parseFloat(process.env.GEMINI_TEMPERATURE || "0.7"),
        maxOutputTokens: parseInt(
          process.env.GEMINI_MAX_OUTPUT_TOKENS || "2048"
        ),
        streaming: true,
      });

      // Stream response
      const stream = await streamingModel.stream(messages);

      for await (const chunk of stream) {
        if (chunk.content) {
          yield chunk.content;
        }
      }

      logger.info("Streaming response completed");
    } catch (error) {
      logger.error("Error generating streaming response", {
        error: error.message,
      });
      throw new Error(`Gemini streaming error: ${error.message}`);
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
      logger.info("Chat invocation", {
        messageLength: userMessage.length,
        historyLength: conversationHistory.length,
      });

      const response = await this.generateResponse(userMessage, {
        systemPrompt,
        conversationHistory,
      });

      // Build updated history
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
      logger.error("Error in chat", { error: error.message });
      throw error;
    }
  }

  /**
   * Build message array for LLM
   * @private
   */
  _buildMessages(prompt, options) {
    const messages = [];

    // Add system message if provided
    if (options.systemPrompt) {
      messages.push(new SystemMessage(options.systemPrompt));
    }

    // Add conversation history
    if (options.conversationHistory && options.conversationHistory.length > 0) {
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

    // Add current user message
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
      logger.error("LLM health check failed", { error: error.message });
      return false;
    }
  }
}
