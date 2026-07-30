import ConversationRepository from "../../database/conversationsRepo.js";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../../utils/logger.js";
import RagChain from "../../RAG/ragService.js";
import LLMService, { resolveLLMSelection } from "../../RAG/query/llmService.js";
import MemoryService from "../../RAG/query/memoryService.js";
import { LLM_INVOCATION_TYPES } from "../../utils/constants.js";

import { routeIntent } from "../../agent/intentRouter.js";
import { calendarAgentGraph } from "../../agent/calenderAgent/graph.js";
import {
  getEmailSessionStatus,
  invokeEmailAgent,
  hasActiveEmailSession,
} from "../../agent/emailAgent/index.js";

const conversationRepo = new ConversationRepository();
const ragChainService = new RagChain();
const ragMemoryService = new MemoryService();
const llmService = new LLMService();

const CHAT_NOT_FOUND_RESPONSE = {
  success: false,
  error: "Chat does not exist",
};

class ChatController {
  async _getConversationStatus(conversationId, userId) {
    if (!conversationId) {
      return { exists: false, active: false, totalCount: 0, activeCount: 0 };
    }

    return conversationRepo.getConversationStatus(conversationId, userId);
  }

  async _ensureReadableConversation(conversationId, userId, res) {
    const status = await this._getConversationStatus(conversationId, userId);

    if (!status.active) {
      res.status(404).json(CHAT_NOT_FOUND_RESPONSE);
      return false;
    }

    return true;
  }

  async _ensureWritableConversation(conversationId, userId, res) {
    if (!conversationId) return true;

    const status = await this._getConversationStatus(conversationId, userId);

    // Preserve the existing first-message flow where a frontend may pass a
    // freshly generated conversation id before any row exists.
    if (!status.exists || status.active) return true;

    res.status(404).json(CHAT_NOT_FOUND_RESPONSE);
    return false;
  }

  async _resolveHandler(
    message,
    conversationId,
    confirmationStatus,
    agentActive,
    activeAgentMode,
    userId,
    llmProvider,
    model,
  ) {
    if (confirmationStatus) {
      return { handler: "agent", confirmationStatus };
    }

    if (agentActive) {
      if (conversationId) {
        const emailActive = await hasActiveEmailSession(conversationId, userId);
        if (emailActive) {
          return { handler: "email_agent" };
        }
      }

      if (activeAgentMode === "agent") {
        return { handler: "agent" };
      }

      if (activeAgentMode === "email_agent" && conversationId) {
        return { handler: "email_agent_status" };
      }
    }

    const intent = await routeIntent(message, conversationId, userId, llmProvider, model);
    logger.info("Intent routed", { intent, conversationId });

    if (intent === "calendar_agent") return { handler: "agent", intent };
    if (intent === "calendar_rag") return { handler: "calendar_rag", intent };
    if (intent === "email_draft")
      return { handler: "email_agent", intent: "email_draft" };
    if (intent === "email_reply")
      return { handler: "email_reply_unavailable", intent };
    if (intent === "email_read") return { handler: "rag", intent };
    if (intent === "rag") return { handler: "rag", intent };
    return { handler: "Normal", intent: "general" };
  }

  async sendMessage(req, res) {
    const {
      message,
      conversationId,
      llmProvider,
      provider,
      model,
      modelName,
      confirmationStatus,
      agentActive,
      activeAgentMode,
    } = req.body;
    const userId = req.user?.userId ?? parseInt(process.env.SYNC_USER_ID, 10);

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: "Message is required",
      });
    }

    let selectedLLM;
    try {
      selectedLLM = resolveLLMSelection(provider ?? llmProvider, model ?? modelName);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    try {
      const writable = await this._ensureWritableConversation(conversationId, userId, res);
      if (!writable) return;

      const {
        handler,
        intent,
        confirmationStatus: cs,
      } = await this._resolveHandler(
        message.trim(),
        conversationId,
        confirmationStatus,
        agentActive,
        activeAgentMode,
        userId,
        selectedLLM.provider,
        selectedLLM.model,
      );

      // ── Email agent ─────────────────────────────────────────────────────────
      if (handler === "email_agent") {
        const threadId = conversationId ?? uuidv4();

        // When agentActive is true and no intent is set, the user is responding
        // to an interrupt (approve / pick / feedback). Pass their message as the
        // resume value so Command({ resume }) is used internally.
        // When intent IS set, this is the first turn of a new email session.
        const isResumeTurn = !intent;
        let finalState;
        try {
          finalState = await invokeEmailAgent(
            message.trim(),
            threadId,
            intent ?? null,
            userId,
            isResumeTurn ? message.trim() : null,
            selectedLLM.provider,
            selectedLLM.model,
          );
        } catch (error) {
          logger.error("Email agent execution failed", {
            error: error.message,
            conversationId: threadId,
            userId,
          });

          const session = await getEmailSessionStatus(threadId, userId)
            .catch(() => null);

          return res.status(500).json({
            success: false,
            error: "The email workflow could not continue. Please try again.",
            conversationId: threadId,
            mode: "email_agent",
            agentActive: session?.active ?? false,
            emailStatus: session?.emailStatus ?? "failed",
          });
        }

        const emailSessionEnded = finalState.status === "complete";

        if (finalState.agentResponse) {
          const assistantMessage =
            typeof finalState.agentResponse === "object"
              ? JSON.stringify(finalState.agentResponse)
              : finalState.agentResponse;
          await conversationRepo.saveChatConversation({
            conversation_id: threadId,
            user_message: message.trim(),
            assistant_message: assistantMessage,
            metadata: { mode: "email_agent", emailStatus: finalState.emailStatus },
            userId,
          });
          logger.info("Saved email agent conversation to database", { conversationId: threadId });
        }

        return res.json({
          success: true,
          queryId: uuidv4(),
          conversationId: threadId,
          query: message.trim(),
          response: finalState.agentResponse,
          emailResponse: finalState.emailResponse ?? null,
          mode: "email_agent",
          agentActive: !emailSessionEnded,
          emailStatus: finalState.emailStatus,
          context: {
            documentsUsed: [],
            totalDocuments: 0,
            selectedDocuments: 0,
          },
          metadata: {},
        });
      }

      if (handler === "email_reply_unavailable") {
        const threadId = conversationId ?? uuidv4();
        const response = "Secure reply drafting is not available yet because the original email thread cannot be verified. Please ask me to compose a new email and include the recipient and the message you want to send.";

        await conversationRepo.saveChatConversation({
          conversation_id: threadId,
          user_message: message.trim(),
          assistant_message: response,
          metadata: { mode: "email_agent", emailStatus: "not_started" },
          userId,
        });

        return res.json({
          success: true,
          queryId: uuidv4(),
          conversationId: threadId,
          query: message.trim(),
          response,
          emailResponse: null,
          mode: "email_agent",
          agentActive: false,
          emailStatus: "not_started",
          context: {
            documentsUsed: [],
            totalDocuments: 0,
            selectedDocuments: 0,
          },
          metadata: {},
        });
      }

      if (handler === "email_agent_status") {
        const session = await getEmailSessionStatus(conversationId, userId);
        const emailStatus = session.emailStatus ?? "not_started";

        const response = emailStatus === "sent"
          ? "The email has already been sent, so it can no longer be revoked."
          : emailStatus === "revoked"
            ? "The email send was already revoked. Nothing was sent."
            : emailStatus === "cancelled"
              ? session.response || "The email workflow was cancelled. Nothing was sent."
            : emailStatus === "failed"
              ? session.response || "The email was not sent because sending failed."
              : session.response || "There is no active email send to revoke.";

        return res.json({
          success: true,
          queryId: uuidv4(),
          conversationId,
          query: message.trim(),
          response,
          emailResponse: null,
          mode: "email_agent",
          agentActive: session.active,
          emailStatus,
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
          ? {
            confirmationStatus: cs,
            userId,
            llmProvider: selectedLLM.provider,
            model: selectedLLM.model,
          }
          : {
            userMessage: message.trim(),
            userId,
            llmProvider: selectedLLM.provider,
            model: selectedLLM.model,
            confirmationStatus: null,
            // Only reset eventDetails at the start of a new agent conversation.
            // Mid-collection turns must NOT send null or the checkpoint-persisted
            // fields (e.g. title already collected) will be wiped by the reducer.
            ...(agentActive ? {} : { eventDetails: null }),
          };

        const agentResult = await calendarAgentGraph.invoke(agentInput, {
          configurable: {
            thread_id: threadId,
            user_id: userId,
            llmProvider: selectedLLM.provider,
            model: selectedLLM.model,
          },
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
        const result = await ragChainService.chat({
          userMessage: message.trim(),
          conversationId,
          userId,
          llmProvider: selectedLLM.provider,
          model: selectedLLM.model,
          RetrieveOptions: {
            sourceType: "calendar",
          },
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
          mode: "calendar_rag",
          context: {
            documentsUsed: result.sourcedDocuments,
            totalDocuments: result.sourcedDocuments.length,
            selectedDocuments: result.sourcedDocuments.length,
          },
          metadata: {
            duration: result?.duration,
            provider: result.provider,
            model: result.model,
            sourceType: "calendar",
          },
        });
      }

      // ── Default RAG ──────────────────────────────────────────────────────────
      if (handler === 'rag') {
        const result = await ragChainService.chat({
          userMessage: message.trim(),
          conversationId,
          userId,
          llmProvider: selectedLLM.provider,
          model: selectedLLM.model,
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
            provider: result.provider,
            model: result.model,
          }
        })
      }

      // ── General ───────────────────────────────────────────────────────────── 

      // Resolve once — used consistently for LLM call, DB save, and response
      const threadId = conversationId ?? uuidv4();

      const messageHistory = await ragMemoryService.loadHistory(threadId, userId);

      const messages = [
        {
          role: "system",
          content: "You are a helpful assistant. Answer the user's questions in a simple and conversational way.",
        },
        ...messageHistory,
        {
          role: "user",
          content: message.trim(),
        },
      ];

      const generalLLMResponse = await llmService.generateResponse(
        selectedLLM.provider,
        messages,
        userId,
        threadId,
        {
          model: selectedLLM.model,
          invocationType: LLM_INVOCATION_TYPES.GENERAL_CHAT,
        }
      );

      if (!generalLLMResponse.answer) {
        return res.status(500).json({
          success: false,
          error: "Failed to process message",
        });
      }

      await conversationRepo.saveChatConversation({
        conversation_id: threadId,
        user_message: message.trim(),
        assistant_message: generalLLMResponse.answer,
        metadata: { mode: "general_chat" },
        userId,
      });

      return res.json({
        success: true,
        queryId: uuidv4(),
        conversationId: threadId,
        query: message.trim(),
        response: generalLLMResponse.answer,
        context: {
          documentsUsed: [],
          totalDocuments: 0,
          selectedDocuments: 0,
        },
        metadata: {
          provider: generalLLMResponse.provider,
          model: generalLLMResponse.model,
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

  async getEmailStatus(req, res) {
    const { conversationId } = req.params;
    const userId = req.user?.userId ?? parseInt(process.env.SYNC_USER_ID, 10);

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: "Conversation ID is required",
      });
    }

    try {
      const readable = await this._ensureReadableConversation(conversationId, userId, res);
      if (!readable) return;

      const status = await getEmailSessionStatus(conversationId, userId);
      return res.json({ success: true, conversationId, ...status });
    } catch (error) {
      logger.error("Failed to read email session status", {
        error: error.message,
        conversationId,
        userId,
      });
      return res.status(500).json({
        success: false,
        error: "Failed to read email status",
      });
    }
  }

  // async sendMessageStream(req, res) {
  //   const { message, conversationId, confirmationStatus, agentActive } =
  //     req.body;
  //   const userId = req.user?.userId ?? parseInt(process.env.SYNC_USER_ID, 10);

  //   if (!message || typeof message !== "string" || !message.trim()) {
  //     return res.status(400).json({
  //       success: false,
  //       error: "Message is required",
  //     });
  //   }

  //   try {
  //     res.setHeader("Content-Type", "text/event-stream");
  //     res.setHeader("Cache-Control", "no-cache");
  //     res.setHeader("Connection", "keep-alive");

  //     const queryId = uuidv4();

  //     const {
  //       handler,
  //       intent,
  //       confirmationStatus: cs,
  //     } = await this._resolveHandler(
  //       message.trim(),
  //       conversationId,
  //       confirmationStatus,
  //       agentActive,
  //       userId,
  //     );

  //     // ── Email agent (non-streaming — emits a single SSE event) ──────────────
  //     if (handler === "email_agent") {
  //       const threadId = conversationId ?? uuidv4();

  //       const finalState = await invokeEmailAgent(
  //         message.trim(),
  //         threadId,
  //         intent ?? null,
  //         userId,
  //       );

  //       const emailSessionEnded = EMAIL_TERMINAL_STATUSES.includes(
  //         finalState.status,
  //       );

  //       if (finalState.agentResponse) {
  //         const assistantMessage = typeof finalState.agentResponse === "object"
  //           ? JSON.stringify(finalState.agentResponse)
  //           : finalState.agentResponse;
  //         await conversationRepo.saveChatConversation({
  //           conversation_id: threadId,
  //           user_message: message.trim(),
  //           assistant_message: assistantMessage,
  //           metadata: { mode: "email_agent", emailStatus: finalState.status },
  //         });
  //         logger.info("Saved email agent conversation to database", { conversationId: threadId });
  //       }

  //       const emailEvent = {
  //         type: "done",
  //         queryId,
  //         conversationId: threadId,
  //         mode: "email_agent",
  //         agentActive: !emailSessionEnded,
  //         emailStatus: finalState.status,
  //         data: {
  //           fullResponse: finalState.agentResponse,
  //           sourceDocuments: [],
  //         },
  //       };

  //       res.write(`data: ${JSON.stringify(emailEvent)}\n\n`);
  //       res.write("data: [DONE]\n\n");
  //       return res.end();
  //     }

  //     // ── Calendar agent (non-streaming — emits a single SSE event) ───────────
  //     if (handler === "agent") {
  //       const threadId = conversationId ?? uuidv4();

  //       const agentInput = cs
  //         ? { confirmationStatus: cs, userId }
  //         : {
  //           userMessage: message.trim(),
  //           userId,
  //           confirmationStatus: null,
  //           ...(agentActive ? {} : { eventDetails: null }),
  //         };

  //       const agentResult = await calendarAgentGraph.invoke(agentInput, {
  //         configurable: { thread_id: threadId },
  //       });

  //       const agentDone =
  //         agentResult.confirmationStatus === "confirmed" ||
  //         agentResult.confirmationStatus === "rejected";

  //       const agentEvent = {
  //         type: "done",
  //         queryId,
  //         conversationId: threadId,
  //         mode: "agent",
  //         pendingConfirmation:
  //           agentResult.confirmationStatus === "pending_confirmation",
  //         agentActive: !agentDone,
  //         data: {
  //           fullResponse: agentResult.responseToUser,
  //           sourceDocuments: [],
  //         },
  //       };

  //       res.write(`data: ${JSON.stringify(agentEvent)}\n\n`);
  //       res.write("data: [DONE]\n\n");
  //       return res.end();
  //     }

  //     // ── Streaming sources (calendar_rag or default rag) ──────────────────────
  //     // TODO: the new RAG pipeline (src/RAG) doesn't support streaming yet
  //     // (LLMService is configured with streaming: false). Implement a
  //     // streaming generator there and wire it in here once ready.
  //     async function* defaultRagStreamNotImplemented() {
  //       yield {
  //         type: "error",
  //         data: { error: "Streaming chat is not yet implemented for the new RAG pipeline" },
  //       };
  //     }

  //     const streamSource =
  //       handler === "calendar_rag"
  //         ? calendarRagService.chatStream(message.trim(), conversationId, userId)
  //         : defaultRagStreamNotImplemented();

  //     let fullResponse = "";

  //     for await (const chunk of streamSource) {
  //       let normalized;

  //       switch (chunk.type) {
  //         case "context":
  //           normalized = {
  //             type: "context",
  //             queryId,
  //             data: {
  //               documentsUsed: chunk.data.sources || [],
  //               totalDocuments: chunk.data.documentsFound,
  //             },
  //           };
  //           break;
  //         case "text":
  //           fullResponse += chunk.data;
  //           normalized = { type: "text", queryId, data: chunk.data };
  //           break;
  //         case "done":
  //           normalized = {
  //             type: "done",
  //             queryId,
  //             data: {
  //               fullResponse,
  //               sourceDocuments: chunk.data.sourceDocuments,
  //             },
  //           };
  //           break;
  //         default:
  //           normalized = { ...chunk, queryId };
  //       }

  //       res.write(`data: ${JSON.stringify(normalized)}\n\n`);
  //     }

  //     res.write("data: [DONE]\n\n");
  //     res.end();
  //   } catch (error) {
  //     logger.error("Chat stream controller error", { error: error.message });
  //     if (!res.headersSent) {
  //       return res.status(500).json({
  //         success: false,
  //         error: "Failed to process message",
  //       });
  //     }
  //     res.end();
  //   }
  // }

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
      const readable = await this._ensureReadableConversation(conversationId, userId, res);
      if (!readable) return;

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
    const userId = req.user?.userId ?? parseInt(process.env.SYNC_USER_ID, 10);
    try {
      const rows = await conversationRepo.getConversations(limit, userId);

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

  async deleteConversation(req, res) {
    const { conversationId } = req.params;
    const userId = req.user?.userId ?? parseInt(process.env.SYNC_USER_ID, 10);

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: "Conversation ID is required",
      });
    }

    try {
      const deletedRows = await conversationRepo.clear(conversationId, userId);

      if (!deletedRows) {
        logger.warn("Delete conversation not found", {
          conversationId,
          userId,
          hasAuthUser: Boolean(req.user),
        });
        return res.status(404).json(CHAT_NOT_FOUND_RESPONSE);
      }

      return res.json({
        success: true,
        data: {
          conversationId,
          deleted: true,
        },
      });
    } catch (error) {
      logger.error("Delete conversation error", {
        error: error.message,
        conversationId,
        userId,
      });
      return res.status(500).json({
        success: false,
        error: "Failed to delete conversation",
      });
    }
  }
}

export default new ChatController();
