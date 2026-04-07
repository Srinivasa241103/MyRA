import langchainChatService from "../../service/langchain/chatService.js";
import calendarRagService from "../../service/langchain/calendarRagService.js";
import ConversationRepository from "../../database/conversationsRepo.js";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../../utils/logger.js";

import { routeIntent } from "../../service/router/intentRouter.js";
import { calendarAgentGraph } from "../../service/agent/calenderAgent/graph.js";

const conversationRepo = new ConversationRepository();

class ChatController {
  async _resolveHandler(
    message,
    conversationId,
    confirmationStatus,
    agentActive
  ) {
    // Skip routing if we're already mid-agent-conversation (collecting details
    // or awaiting confirmation). The conversationId doubles as thread_id.
    if (confirmationStatus || agentActive) {
      return { handler: "agent", confirmationStatus };
    }

    const intent = await routeIntent(message);
    logger.info("Intent routed", { intent, conversationId });

    if (intent === "calendar_agent") return { handler: "agent", intent };
    if (intent === "calendar_rag") return { handler: "calendar_rag", intent };
    return { handler: "rag", intent };
  }

  async sendMessage(req, res) {
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
      const {
        handler,
        intent,
        confirmationStatus: cs,
      } = await this._resolveHandler(
        message.trim(),
        conversationId,
        confirmationStatus,
        agentActive
      );

      if (handler === "agent") {
        // Always ensure a stable thread ID — null would collapse all new
        // conversations onto the same LangGraph checkpoint.
        const threadId = conversationId ?? uuidv4();

        const agentInput = cs
          ? { confirmationStatus: cs, userId }
          : {
              userMessage: message.trim(),
              userId,
              // Explicitly reset so stale "confirmed" from a prior event on the
              // same thread doesn't trigger an immediate create_event.
              confirmationStatus: null,
              eventDetails: null,
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
          agentActive: !agentDone, // tells frontend to keep bypassing routeIntent
          context: {
            documentsUsed: [],
            totalDocuments: 0,
            selectedDocuments: 0,
          },
          metadata: {},
        });
      }

      if (handler === "calendar_rag") {
        const result = await calendarRagService.chat(
          message.trim(),
          conversationId
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

      const result = await langchainChatService.chat(
        message.trim(),
        conversationId
      );

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
          documentsUsed: result.sourceDocuments,
          totalDocuments: result.sourceDocuments.length,
          selectedDocuments: result.sourceDocuments.length,
        },
        metadata: {
          duration: result.duration,
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

      const { handler, confirmationStatus: cs } = await this._resolveHandler(
        message.trim(),
        conversationId,
        confirmationStatus,
        agentActive
      );

      if (handler === "agent") {
        // Agents are not streamed — they pause and wait for user input.
        // Emit a single SSE event and close, same shape as streaming "done".
        const threadId = conversationId ?? uuidv4();

        const agentInput = cs
          ? { confirmationStatus: cs, userId }
          : {
              userMessage: message.trim(),
              userId,
              confirmationStatus: null,
              eventDetails: null,
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

      // Choose stream source based on handler
      const streamSource =
        handler === "calendar_rag"
          ? calendarRagService.chatStream(message.trim(), conversationId)
          : langchainChatService.chatStream(message.trim(), conversationId);

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

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: "Conversation ID is required",
      });
    }

    try {
      const messages = await langchainChatService.getHistory(conversationId);

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
