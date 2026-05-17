import LangChainLLMService from "../langchain/llm.js";
import { logger } from "../../utils/logger.js";

const llm = new LangChainLLMService();

const SYSTEM_PROMPT = `You are an intent classifier. Classify the user message into exactly one of these categories:
- calendar_agent: The user wants to CREATE, SCHEDULE, ADD, UPDATE, MODIFY, DELETE, or CANCEL a calendar event
- calendar_rag: The user wants to READ, VIEW, LIST, CHECK, or QUERY existing calendar events or schedule
- rag: Anything else (emails, general questions, etc.)

Respond with ONLY the category name, nothing else.`;

export async function routeIntent(message) {
  try {
    const response = await llm.generateResponse(message, {
      systemPrompt: SYSTEM_PROMPT,
    });
    const intent = response.text.trim().toLowerCase();

    if (intent === "calendar_agent" || intent === "calendar_rag") {
      return intent;
    }
    return "rag";
  } catch (error) {
    logger.error("Intent routing failed, defaulting to rag", {
      error: error.message,
    });
    return "rag";
  }
}
