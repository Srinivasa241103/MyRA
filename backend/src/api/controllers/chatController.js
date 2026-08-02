import { v4 as uuidv4 } from "uuid";
import RagChain from "../../RAG/ragService.js";
import { resolveLLMSelection } from "../../RAG/query/llmService.js";
import ConversationRepository from "../../database/conversationsRepo.js";
import { createSseWriter } from "../../utils/sseWriter.js";
import { logger } from "../../utils/logger.js";

const conversationRepo = new ConversationRepository();
const ragChainService = new RagChain();

const CHAT_NOT_FOUND_RESPONSE = {
  success: false,
  error: "Chat does not exist",
};

const emptyContext = () => ({
  documentsUsed: [],
  totalDocuments: 0,
  selectedDocuments: 0,
});

function parseStoredMetadata(value) {
  let parsed = value;
  for (let attempt = 0; attempt < 2 && typeof parsed === "string"; attempt += 1) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  return parsed && typeof parsed === "object" ? parsed : {};
}

function buildRagResponse(result, queryId, query) {
  const documents = result.sourcedDocuments ?? [];

  return {
    success: true,
    queryId,
    conversationId: result.conversationId,
    query,
    response: result.response,
    mode: "rag",
    context: {
      documentsUsed: documents,
      totalDocuments: documents.length,
      selectedDocuments: documents.length,
    },
    metadata: {
      duration: result.duration,
      provider: result.provider,
      model: result.model,
      clarificationRequired: Boolean(result.clarificationRequired),
      streamStatus: result.stopped ? "stopped" : "complete",
    },
  };
}

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

    // A client may allocate a conversation id before the first row is saved.
    if (!status.exists || status.active) return true;

    res.status(404).json(CHAT_NOT_FOUND_RESPONSE);
    return false;
  }

  async sendMessage(req, res) {
    const {
      message,
      conversationId,
      llmProvider,
      provider,
      model,
      modelName,
    } = req.body;
    const userId = req.user?.userId ?? parseInt(process.env.SYNC_USER_ID, 10);
    const query = typeof message === "string" ? message.trim() : "";

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "Message is required",
      });
    }

    let selectedLLM;
    try {
      selectedLLM = resolveLLMSelection(provider ?? llmProvider, model ?? modelName);
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }

    try {
      const writable = await this._ensureWritableConversation(conversationId, userId, res);
      if (!writable) return;

      const result = await ragChainService.chat({
        userMessage: query,
        conversationId,
        userId,
        llmProvider: selectedLLM.provider,
        model: selectedLLM.model,
      });

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error || "Failed to process message",
          conversationId: result.conversationId,
        });
      }

      return res.json(buildRagResponse(result, uuidv4(), query));
    } catch (error) {
      logger.error("Chat controller error", { error: error.message });
      return res.status(500).json({
        success: false,
        error: "Failed to process message",
      });
    }
  }

  async sendMessageStream(req, res) {
    const {
      message,
      conversationId,
      llmProvider,
      provider,
      model,
      modelName,
    } = req.body;
    const userId = req.user?.userId ?? parseInt(process.env.SYNC_USER_ID, 10);
    const query = typeof message === "string" ? message.trim() : "";

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "Message is required",
      });
    }

    let selectedLLM;
    try {
      selectedLLM = resolveLLMSelection(provider ?? llmProvider, model ?? modelName);
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }

    const threadId = conversationId ?? uuidv4();
    try {
      const writable = await this._ensureWritableConversation(threadId, userId, res);
      if (!writable) return;
    } catch (error) {
      logger.error("Failed to prepare streaming conversation", {
        error: error.message,
        conversationId: threadId,
        userId,
      });
      return res.status(500).json({
        success: false,
        error: "Failed to prepare conversation",
      });
    }

    const queryId = uuidv4();
    const abortController = new AbortController();
    const writer = createSseWriter(res);

    const abortStream = () => {
      if (!res.writableEnded && !abortController.signal.aborted) {
        abortController.abort();
      }
    };
    req.once("aborted", abortStream);
    res.once("close", abortStream);

    const send = (type, data = null) => writer.send(type, {
      queryId,
      conversationId: threadId,
      data,
    });
    const sendStatus = (stage, { detail = null, cancellable = false } = {}) =>
      send("status", { stage, flow: "rag", detail, cancellable });
    const finish = (payload, { stopped = false } = {}) => {
      send("result", payload);
      send("done", { stopped });
      writer.end();
      return payload;
    };

    try {
      send("start", { query });
      sendStatus("routing");

      let streamedContext = emptyContext();
      const result = await ragChainService.chat({
        userMessage: query,
        conversationId: threadId,
        userId,
        llmProvider: selectedLLM.provider,
        model: selectedLLM.model,
        stream: {
          signal: abortController.signal,
          onStatus: (status) => sendStatus(status.stage, status),
          onContext: (documents) => {
            streamedContext = {
              documentsUsed: documents,
              totalDocuments: documents.length,
              selectedDocuments: documents.length,
            };
            send("context", streamedContext);
          },
          onToken: (text) => send("delta", { text }),
        },
      });

      if (!result.success) {
        if (abortController.signal.aborted) return;
        const ragError = new Error(result.error || "Failed to process message");
        ragError.partialAnswer = result.partialResponse || "";
        throw ragError;
      }

      const payload = buildRagResponse(result, queryId, query);
      if (streamedContext.selectedDocuments) {
        payload.context = streamedContext;
      }

      return finish(payload, { stopped: result.stopped });
    } catch (error) {
      const stopped = abortController.signal.aborted || error?.name === "AbortError";

      if (error?.partialAnswer && !stopped) {
        await conversationRepo.saveChatConversation({
          conversation_id: threadId,
          user_message: query,
          assistant_message: error.partialAnswer,
          metadata: { mode: "rag", streamStatus: "interrupted" },
          userId,
        }).catch(() => undefined);
      }

      logger.error("Chat stream controller error", {
        error: error.message,
        conversationId: threadId,
        userId,
        stopped,
      });

      if (writer.closed) return;
      send("error", {
        error: stopped ? "Response stopped." : "Failed to process message",
        mode: "rag",
        partialResponse: error?.partialAnswer || null,
        stopped,
      });
      send("done", { stopped });
      writer.end();
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
      const readable = await this._ensureReadableConversation(conversationId, userId, res);
      if (!readable) return;

      const { rows } = await conversationRepo.getConversationHistory(
        conversationId,
        userId,
        limit,
      );
      const history = rows.map((row) => ({
        user_message: row.user_message || "",
        assistant_message: row.assistant_message || "",
        metadata: parseStoredMetadata(row.metadata),
      }));

      return res.json({
        success: true,
        data: { conversationId, history },
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
