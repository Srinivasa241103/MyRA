import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import LangChainLLMService from "./llm.js";
import vectorStore from "./vectorStore.js";
import LangChainMemoryService from "./memory.js";
import { logger } from "../../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

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
    this.llm = new LangChainLLMService();
    this.memory = new LangChainMemoryService();
  }

  async chat(userMessage, conversationId = null) {
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

    const history = await this.memory.loadHistory(conversationId);
    const chatHistory = history
      .slice(-10)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    const answerChain = RunnableSequence.from([
      CALENDAR_PROMPT,
      this.llm.model,
      new StringOutputParser(),
    ]);

    const answer = await answerChain.invoke({ context, chat_history: chatHistory, question: userMessage });
    const duration = Date.now() - startTime;

    await this.memory.saveConversation(conversationId, userMessage, answer, {
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

  async *chatStream(userMessage, conversationId = null) {
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
    const history = await this.memory.loadHistory(conversationId);
    const chatHistory = history.slice(-10).map((msg) => `${msg.role}: ${msg.content}`).join("\n");

    const prompt = await CALENDAR_PROMPT.format({ context, chat_history: chatHistory, question: userMessage });

    let fullAnswer = "";
    for await (const chunk of this.llm.generateStreamingResponse(prompt)) {
      fullAnswer += chunk;
      yield { type: "text", data: chunk };
    }

    await this.memory.saveConversation(conversationId, userMessage, fullAnswer, {
      sourceDocuments: retrievedDocs.length,
    });

    yield { type: "done", data: { sourceDocuments: retrievedDocs, conversationId } };
  }
}

export default new CalendarRagService();
