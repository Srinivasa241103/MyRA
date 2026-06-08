import calendarRagService from "../../service/langchain/calendarRagService.js";
import ConversationRepository from "../../database/conversationsRepo.js";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../../utils/logger.js";
import RagChain from "../../RAG/ragService.js";
import RagMemoryService from "../../RAG/query/memoryService.js";

import { routeIntent } from "../../service/router/intentRouter.js";
import { calendarAgentGraph } from "../../agent/calenderAgent/graph.js";
import {
  invokeEmailAgent,
  hasActiveEmailSession,
} from "../../agent/emailAgent/index.js";

const conversationRepo = new ConversationRepository();
const ragChainService = new RagChain();
const ragMemoryService = new RagMemoryService();

// Statuses that mean the email session is fully finished
const EMAIL_TERMINAL_STATUSES = ["sent", "saved_draft", "cancelled", "idle"];

class ChatController {
  async _resolveHandler(
    message,
    conversationId,
    confirmationStatus,
    agentActive,
    userId,
  ) {
    if (confirmationStatus || agentActive) {
      if (conversationId) {
        const emailActive = await hasActiveEmailSession(conversationId);
        if (emailActive) {
          return { handler: "email_agent" };
        }
      }
      // No active email session — fall through to calendar agent (existing behaviour)
      return { handler: "agent", confirmationStatus };
    }

    const intent = await routeIntent(message, conversationId, userId);
    logger.info("Intent routed", { intent, conversationId });

    if (intent === "calendar_agent") return { handler: "agent", intent };
    if (intent === "calendar_rag") return { handler: "rag", intent };
    if (intent === "email_draft")
      return { handler: "email_agent", intent: "email_draft" };
    if (intent === "email_reply")
      return { handler: "email_agent", intent: "email_reply" };
    if (intent === "email_read") return { handler: "rag", intent };
    if (intent === "rag") return { handler: "rag", intent };
    return { handler: "Normal", intent: "general" }
  }

  async sendMessage(req, res) {
    const { message, conversationId, llmProvider, confirmationStatus, agentActive } =
      req.body;
    const userId = req.user?.userId ?? parseInt(process.env.SYNC_USER_ID, 10);

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: "Message is required",
      });
    }

    try {
      const {
        handler,
        intent,
        confirmationStatus: cs,
      } = await this._resolveHandler(
        message.trim(),
        conversationId,
        confirmationStatus,
        agentActive,
        userId,
      );

      // ── Email agent ─────────────────────────────────────────────────────────
      if (handler === "email_agent") {
        const threadId = conversationId ?? uuidv4();

        const finalState = await invokeEmailAgent(
          message.trim(),
          threadId,
          // Pass intent only on the first turn; subsequent turns read it from
          // the checkpointed state.
          intent ?? null,
          userId,
        );

        const emailSessionEnded = EMAIL_TERMINAL_STATUSES.includes(
          finalState.status,
        );

        if (finalState.agentResponse) {
          const assistantMessage = typeof finalState.agentResponse === "object"
            ? JSON.stringify(finalState.agentResponse)
            : finalState.agentResponse;
          await conversationRepo.saveChatConversation({
            conversation_id: threadId,
            user_message: message.trim(),
            assistant_message: assistantMessage,
            metadata: { mode: "email_agent", emailStatus: finalState.status },
          });
          logger.info("Saved email agent conversation to database", { conversationId: threadId });
        }

        return res.json({
          success: true,
          queryId: uuidv4(),
          conversationId: threadId,
          query: message.trim(),
          response: finalState.agentResponse,
          mode: "email_agent",
          agentActive: !emailSessionEnded,
          emailStatus: finalState.status,
          context: {
            documentsUsed: [],
            totalDocuments: 0,
            selectedDocuments: 0,
          },
          metadata: {},
        });
      }

      // ── Calendar agent ───────────────────────────────────────────────────────
      if (handler === "agent") {
        // Always ensure a stable thread ID — null would collapse all new
        // conversations onto the same LangGraph checkpoint.
        const threadId = conversationId ?? uuidv4();

        const agentInput = cs
          ? { confirmationStatus: cs, userId }
          : {
            userMessage: message.trim(),
            userId,
            confirmationStatus: null,
            // Only reset eventDetails at the start of a new agent conversation.
            // Mid-collection turns must NOT send null or the checkpoint-persisted
            // fields (e.g. title already collected) will be wiped by the reducer.
            ...(agentActive ? {} : { eventDetails: null }),
          };

        const agentResult = await calendarAgentGraph.invoke(agentInput, {
          configurable: { thread_id: threadId },
        });

        const agentDone =
          agentResult.confirmationStatus === "confirmed" ||
          agentResult.confirmationStatus === "rejected";

        return res.json({
          success: true,
          queryId: uuidv4(),
          conversationId: threadId,
          query: message.trim(),
          response: agentResult.responseToUser,
          mode: "agent",
          pendingConfirmation:
            agentResult.confirmationStatus === "pending_confirmation",
          agentActive: !agentDone,
          context: {
            documentsUsed: [],
            totalDocuments: 0,
            selectedDocuments: 0,
          },
          metadata: {},
        });
      }

      // ── Calendar RAG ─────────────────────────────────────────────────────────
      if (handler === "calendar_rag") {
        const result = await calendarRagService.chat(
          message.trim(),
          conversationId,
          userId,
        );
        if (!result.success) return res.status(500).json(result);
        return res.json({
          success: true,
          queryId: uuidv4(),
          conversationId: result.conversationId,
          query: message.trim(),
          response: result.response,
          mode: "calendar_rag",
          context: {
            documentsUsed: result.sourceDocuments,
            totalDocuments: result.sourceDocuments.length,
            selectedDocuments: result.sourceDocuments.length,
          },
          metadata: { duration: result.duration },
        });
      }

      // ── Default RAG ──────────────────────────────────────────────────────────
      const result = await ragChainService.chat({
        userMessage: message.trim(),
        conversationId,
        userId,
        llmProvider,
      });

      if (!result.success) {
        return res.status(500).json(result);
      }

      return res.json({
        success: true,
        queryId: uuidv4(),
        conversationId: result.conversationId,
        query: message.trim(),
        response: result.response,
        context: {
          documentsUsed: result.sourcedDocuments,
          totalDocuments: result.sourcedDocuments.length,
          selectedDocuments: result.sourcedDocuments.length,
        },
        metadata: {
          duration: result?.duration,
        },
      });
    } catch (error) {
      logger.error("Chat controller error", { error: error.message });
      return res.status(500).json({
        success: false,
        error: "Failed to process message",
      });
    }
  }

  async sendMessageStream(req, res) {
    const { message, conversationId, confirmationStatus, agentActive } =
      req.body;
    const userId = req.user?.userId ?? parseInt(process.env.SYNC_USER_ID, 10);

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: "Message is required",
      });
    }

    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const queryId = uuidv4();

      const {
        handler,
        intent,
        confirmationStatus: cs,
      } = await this._resolveHandler(
        message.trim(),
        conversationId,
        confirmationStatus,
        agentActive,
        userId,
      );

      // ── Email agent (non-streaming — emits a single SSE event) ──────────────
      if (handler === "email_agent") {
        const threadId = conversationId ?? uuidv4();

        const finalState = await invokeEmailAgent(
          message.trim(),
          threadId,
          intent ?? null,
          userId,
        );

        const emailSessionEnded = EMAIL_TERMINAL_STATUSES.includes(
          finalState.status,
        );

        if (finalState.agentResponse) {
          const assistantMessage = typeof finalState.agentResponse === "object"
            ? JSON.stringify(finalState.agentResponse)
            : finalState.agentResponse;
          await conversationRepo.saveChatConversation({
            conversation_id: threadId,
            user_message: message.trim(),
            assistant_message: assistantMessage,
            metadata: { mode: "email_agent", emailStatus: finalState.status },
          });
          logger.info("Saved email agent conversation to database", { conversationId: threadId });
        }

        const emailEvent = {
          type: "done",
          queryId,
          conversationId: threadId,
          mode: "email_agent",
          agentActive: !emailSessionEnded,
          emailStatus: finalState.status,
          data: {
            fullResponse: finalState.agentResponse,
            sourceDocuments: [],
          },
        };

        res.write(`data: ${JSON.stringify(emailEvent)}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }

      // ── Calendar agent (non-streaming — emits a single SSE event) ───────────
      if (handler === "agent") {
        const threadId = conversationId ?? uuidv4();

        const agentInput = cs
          ? { confirmationStatus: cs, userId }
          : {
            userMessage: message.trim(),
            userId,
            confirmationStatus: null,
            ...(agentActive ? {} : { eventDetails: null }),
          };

        const agentResult = await calendarAgentGraph.invoke(agentInput, {
          configurable: { thread_id: threadId },
        });

        const agentDone =
          agentResult.confirmationStatus === "confirmed" ||
          agentResult.confirmationStatus === "rejected";

        const agentEvent = {
          type: "done",
          queryId,
          conversationId: threadId,
          mode: "agent",
          pendingConfirmation:
            agentResult.confirmationStatus === "pending_confirmation",
          agentActive: !agentDone,
          data: {
            fullResponse: agentResult.responseToUser,
            sourceDocuments: [],
          },
        };

        res.write(`data: ${JSON.stringify(agentEvent)}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }

      // ── Streaming sources (calendar_rag or default rag) ──────────────────────
      // TODO: the new RAG pipeline (src/RAG) doesn't support streaming yet
      // (LLMService is configured with streaming: false). Implement a
      // streaming generator there and wire it in here once ready.
      async function* defaultRagStreamNotImplemented() {
        yield {
          type: "error",
          data: { error: "Streaming chat is not yet implemented for the new RAG pipeline" },
        };
      }

      const streamSource =
        handler === "calendar_rag"
          ? calendarRagService.chatStream(message.trim(), conversationId, userId)
          : defaultRagStreamNotImplemented();

      let fullResponse = "";

      for await (const chunk of streamSource) {
        let normalized;

        switch (chunk.type) {
          case "context":
            normalized = {
              type: "context",
              queryId,
              data: {
                documentsUsed: chunk.data.sources || [],
                totalDocuments: chunk.data.documentsFound,
              },
            };
            break;
          case "text":
            fullResponse += chunk.data;
            normalized = { type: "text", queryId, data: chunk.data };
            break;
          case "done":
            normalized = {
              type: "done",
              queryId,
              data: {
                fullResponse,
                sourceDocuments: chunk.data.sourceDocuments,
              },
            };
            break;
          default:
            normalized = { ...chunk, queryId };
        }

        res.write(`data: ${JSON.stringify(normalized)}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error) {
      logger.error("Chat stream controller error", { error: error.message });
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: "Failed to process message",
        });
      }
      res.end();
    }
  }

  async getHistory(req, res) {
    const { conversationId } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user?.userId ?? parseInt(process.env.SYNC_USER_ID, 10);

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: "Conversation ID is required",
      });
    }

    try {
      const messages = await ragMemoryService.loadHistory(conversationId, userId);

      // Map [{role,content},{role,content}...] pairs → [{user_message, assistant_message}]
      const history = [];
      for (let i = 0; i < messages.length; i += 2) {
        history.push({
          user_message: messages[i]?.content || "",
          assistant_message: messages[i + 1]?.content || "",
        });
      }

      return res.json({
        success: true,
        data: { conversationId, history: history.slice(0, limit) },
      });
    } catch (error) {
      logger.error("Get history error", { error: error.message });
      return res.status(500).json({
        success: false,
        error: "Failed to fetch history",
      });
    }
  }

  async getConversations(req, res) {
    const limit = parseInt(req.query.limit) || 50;
    try {
      const rows = await conversationRepo.getConversations(limit);

      const conversations = rows.map((row) => ({
        conversationId: row.conversation_id,
        title: row.title?.substring(0, 60) || "Untitled",
        startedAt: row.started_at,
        lastMessageAt: row.last_message_at,
      }));

      return res.json({
        success: true,
        data: { conversations },
      });
    } catch (error) {
      logger.error("Get conversations error", { error: error.message });
      return res.status(500).json({
        success: false,
        error: "Failed to fetch conversations",
      });
    }
  }

  async createConversation(req, res) {
    try {
      return res.json({
        success: true,
        data: {
          conversationId: uuidv4(),
          createdAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error("Create conversation error", { error: error.message });
      return res.status(500).json({
        success: false,
        error: "Failed to create conversation",
      });
    }
  }
}

export default new ChatController();
