import langchainChatService from "../../service/langchain/chatService.js";
import ConversationRepository from "../../database/conversationsRepo.js";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../../utils/logger.js";

const conversationRepo = new ConversationRepository();

class ChatController {
  async sendMessage(req, res) {
    const { message, conversationId } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: "Message is required",
      });
    }

    try {
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
    const { message, conversationId } = req.body;

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
      let fullResponse = "";

      for await (const chunk of langchainChatService.chatStream(
        message.trim(),
        conversationId
      )) {
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
