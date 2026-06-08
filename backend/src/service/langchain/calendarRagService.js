import Retriever from "../../RAG/retrieval/retriever.js";
import { buildContext } from "../../RAG/retrieval/contextBuilder.js";
import { buildPrompt } from "../../RAG/query/prompts.js";
import LLMService from "../../RAG/query/llmService.js";
import RagMemoryService from "../../RAG/query/memoryService.js";
import { logger } from "../../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

const LLM_PROVIDER = "Anthropic";
const TOP_K = 15;

const CALENDAR_SYSTEM_PROMPT = `You are a personal AI assistant with access to the user's Google Calendar data.

Instructions:
- Answer based ONLY on the calendar events provided in the retrieved context
- If no relevant events are found, say so clearly
- Format dates and times in a readable way (e.g. "Monday, April 6 at 3:00 PM")
- List events clearly when there are multiple
- If asked about availability, check all events in the given time range`;

class CalendarRagService {
  constructor() {
    this.retriever = new Retriever();
    this.llm = new LLMService();
    this.memory = new RagMemoryService();
  }

  async chat(userMessage, conversationId = null, userId) {
    if (!conversationId) {
      conversationId = uuidv4();
    }

    logger.info("[CalendarRAG] Query", { conversationId, message: userMessage.substring(0, 100) });

    const startTime = Date.now();

    const chunks = await this.retriever.retrieve(userMessage, userId, { sourceType: "calendar", topK: TOP_K });
    logger.info("[CalendarRAG] Retrieved calendar chunks", { count: chunks.length });

    const context = buildContext(chunks);
    const history = await this.memory.loadHistory(conversationId, userId);
    const messages = buildPrompt({ history, context, question: userMessage, systemPrompt: CALENDAR_SYSTEM_PROMPT });

    const llmResult = await this.llm.generateResponse(LLM_PROVIDER, messages, userId, conversationId);
    const answer = llmResult.answer;
    const duration = Date.now() - startTime;

    await this.memory.saveConversation(userId, conversationId, userMessage, answer, {
      sourceCount: chunks.length,
      duration,
    });

    logger.info("[CalendarRAG] Query completed", { duration: `${duration}ms`, sources: chunks.length });

    return {
      success: true,
      conversationId,
      response: answer,
      sourceDocuments: chunks.map((chunk) => ({
        content: chunk.content,
        source: chunk.document?.source_id,
        type: chunk.source_type,
        metadata: chunk.document?.metadata,
      })),
      duration,
    };
  }

  async *chatStream(userMessage, conversationId = null, userId) {
    if (!conversationId) {
      conversationId = uuidv4();
    }

    logger.info("[CalendarRAG] Stream query", { conversationId });

    const chunks = await this.retriever.retrieve(userMessage, userId, { sourceType: "calendar", topK: TOP_K });

    yield {
      type: "context",
      data: {
        documentsFound: chunks.length,
        sources: chunks.map((c) => ({ source: c.document?.source_id, type: c.source_type })),
      },
    };

    const context = buildContext(chunks);
    const history = await this.memory.loadHistory(conversationId, userId);
    const messages = buildPrompt({ history, context, question: userMessage, systemPrompt: CALENDAR_SYSTEM_PROMPT });

    // TODO: LLMService doesn't support token-by-token streaming yet — emit
    // the full answer as a single "text" chunk until it does.
    const llmResult = await this.llm.generateResponse(LLM_PROVIDER, messages, userId, conversationId);
    const fullAnswer = llmResult.answer;
    yield { type: "text", data: fullAnswer };

    await this.memory.saveConversation(userId, conversationId, userMessage, fullAnswer, {
      sourceCount: chunks.length,
    });

    yield { type: "done", data: { sourceDocuments: chunks, conversationId } };
  }
}

export default new CalendarRagService();
