import LLMService from "../RAG/query/llmService.js";
import { logger } from "../utils/logger.js";

const llm = new LLMService();

const SYSTEM_PROMPT = `You are an intent classifier. Classify the user message into exactly one of these categories:
- calendar_agent: The user wants to CREATE, SCHEDULE, ADD, UPDATE, MODIFY, DELETE, or CANCEL a calendar event
- email_draft: The user wants to COMPOSE, WRITE, or SEND a new email to someone
- email_reply: The user wants to REPLY to an existing email they have received
- email_read: The user wants to READ, VIEW, LIST, SUMMARIZE, or SEARCH their emails/mails/inbox
- rag: The user wants to READ, VIEW, LIST OR SUMMARIZE anything related to the emails, calendar data which is other than the agentic intents
- general: Any general question related to Facts or questions not related to the personal data stored (email, calandar events, music tastes, github data)

Respond with ONLY the category name, nothing else.`;

const VALID_INTENTS = [
  "calendar_agent",
  "email_draft",
  "email_reply",
  "email_read",
  "rag",
];

export async function routeIntent(message, conversationId = null, userId = null) {
  try {
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: message },
    ];
    const response = await llm.generateResponse(
      "Anthropic",
      messages,
      userId ?? parseInt(process.env.SYNC_USER_ID, 10),
      conversationId ?? "intent_router",
    );
    const intent = response.answer.trim().toLowerCase();

    if (VALID_INTENTS.includes(intent)) {
      return intent;
    }
    return "general";
  } catch (error) {
    logger.error("Intent routing failed, defaulting to general", {
      error: error.message,
    });
    return "general";
  }
}
