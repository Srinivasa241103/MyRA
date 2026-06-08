import { PromptTemplate } from "@langchain/core/prompts";
import LLMService from "../../RAG/query/llmService.js";
import vectorStore from "./vectorStore.js";
import RagMemoryService from "../../RAG/query/memoryService.js";
import { logger } from "../../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

const LLM_PROVIDER = "anthropic";

const CALENDAR_PROMPT = PromptTemplate.fromTemplate(`
You are a personal AI assistant with access to the user's Google Calendar data.

Calendar events from user's data:
{context}

Chat History:
{chat_history}

User Question: {question}

Instructions:
- Answer based ONLY on the calendar events provided above
- If no relevant events are found, say so clearly
- Format dates and times in a readable way (e.g. "Monday, April 6 at 3:00 PM")
- List events clearly when there are multiple
- If asked about availability, check all events in the given time range

Answer:
`);

class CalendarRagService {
  constructor() {
    this.llm = new LLMService();
    this.memory = new RagMemoryService();
  }

  async chat(userMessage, conversationId = null, userId) {
    if (!conversationId) {
      conversationId = uuidv4();
    }

    logger.info("[CalendarRAG] Query", { conversationId, message: userMessage.substring(0, 100) });

    const startTime = Date.now();

    await vectorStore.initialize();

    // Filter retrieval to calendar documents only
    const retriever = vectorStore.asRetriever(15, { source: "calendar" });
    const sourceDocuments = await retriever.invoke(userMessage);

    logger.info("[CalendarRAG] Retrieved calendar docs", { count: sourceDocuments.length });

    const context = sourceDocuments.map((doc) => doc.pageContent).join("\n\n---\n\n");

    const history = await this.memory.loadHistory(conversationId, userId);
    const chatHistory = history
      .slice(-10)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    const formattedPrompt = await CALENDAR_PROMPT.format({ context, chat_history: chatHistory, question: userMessage });
    const llmResult = await this.llm.generateResponse(
      LLM_PROVIDER,
      [{ role: "user", content: formattedPrompt }],
      userId,
      conversationId,
    );
    const answer = llmResult.answer;
    const duration = Date.now() - startTime;

    await this.memory.saveConversation(userId, conversationId, userMessage, answer, {
      sourceDocuments: sourceDocuments.length,
      duration,
    });

    logger.info("[CalendarRAG] Query completed", { duration: `${duration}ms`, sources: sourceDocuments.length });

    return {
      success: true,
      conversationId,
      response: answer,
      sourceDocuments: sourceDocuments.map((doc) => ({
        content: doc.pageContent,
        source: doc.metadata?.source,
        type: doc.metadata?.type,
        metadata: doc.metadata,
      })),
      duration,
    };
  }

  async *chatStream(userMessage, conversationId = null, userId) {
    if (!conversationId) {
      conversationId = uuidv4();
    }

    logger.info("[CalendarRAG] Stream query", { conversationId });

    await vectorStore.initialize();

    const retriever = vectorStore.asRetriever(15, { source: "calendar" });
    const retrievedDocs = await retriever.invoke(userMessage);

    yield {
      type: "context",
      data: {
        documentsFound: retrievedDocs.length,
        sources: retrievedDocs.map((d) => ({ source: d.metadata?.source, type: d.metadata?.type })),
      },
    };

    const context = retrievedDocs.map((doc) => doc.pageContent).join("\n\n---\n\n");
    const history = await this.memory.loadHistory(conversationId, userId);
    const chatHistory = history.slice(-10).map((msg) => `${msg.role}: ${msg.content}`).join("\n");

    const prompt = await CALENDAR_PROMPT.format({ context, chat_history: chatHistory, question: userMessage });

    // TODO: LLMService doesn't support token-by-token streaming yet — emit
    // the full answer as a single "text" chunk until it does.
    const llmResult = await this.llm.generateResponse(
      LLM_PROVIDER,
      [{ role: "user", content: prompt }],
      userId,
      conversationId,
    );
    const fullAnswer = llmResult.answer;
    yield { type: "text", data: fullAnswer };

    await this.memory.saveConversation(userId, conversationId, userMessage, fullAnswer, {
      sourceDocuments: retrievedDocs.length,
    });

    yield { type: "done", data: { sourceDocuments: retrievedDocs, conversationId } };
  }
}

export default new CalendarRagService();
