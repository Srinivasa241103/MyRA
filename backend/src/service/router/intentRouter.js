import LangChainLLMService from "../langchain/llm.js";
import { logger } from "../../utils/logger.js";

const llm = new LangChainLLMService();

const SYSTEM_PROMPT = `You are an intent classifier. Classify the user message into exactly one of these categories:
- calendar_agent: The user wants to CREATE, SCHEDULE, ADD, UPDATE, MODIFY, DELETE, or CANCEL a calendar event
- calendar_rag: The user wants to READ, VIEW, LIST, CHECK, or QUERY existing calendar events or schedule
- email_draft: The user wants to COMPOSE, WRITE, or SEND a new email to someone
- email_reply: The user wants to REPLY to an existing email they have received
- email_read: The user wants to READ, VIEW, LIST, SUMMARIZE, or SEARCH their emails/mails/inbox
- rag: Anything else (general questions, tasks, reminders not tied to calendar or email, etc.)

Respond with ONLY the category name, nothing else.`;

const VALID_INTENTS = [
  "calendar_agent",
  "calendar_rag",
  "email_draft",
  "email_reply",
  "email_read",
];

export async function routeIntent(message, conversationId = null) {
  try {
    const response = await llm.generateResponse(message, conversationId ?? "intent_router", {
      systemPrompt: SYSTEM_PROMPT,
    });
    const intent = response.text.trim().toLowerCase();

    if (VALID_INTENTS.includes(intent)) {
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
