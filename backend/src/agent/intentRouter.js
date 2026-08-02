import { logger } from "../utils/logger.js";
import LLMService from "../RAG/query/llmService.js";
import { LLM_INVOCATION_TYPES } from "../utils/constants.js";

const llm = new LLMService();

const SYSTEM_PROMPT = `You are an intent classifier. Classify the user message into exactly one of these categories:
- calendar_agent: The user wants to CREATE, SCHEDULE, ADD, UPDATE, MODIFY, RESCHEDULE, DELETE, or CANCEL a calendar event
- calendar_rag: The user wants to READ, VIEW, LIST, SEARCH, SUMMARIZE, or ASK ABOUT existing calendar events, meetings, appointments, availability, or schedule without changing the calendar
- email_draft: The user wants to COMPOSE, WRITE, or SEND a new email to someone
- email_reply: The user wants to REPLY to an existing email they have received
- email_read: The user wants to READ, VIEW, LIST, SUMMARIZE, or SEARCH their emails/mails/inbox
- rag: The user wants to READ, VIEW, LIST, SEARCH, or SUMMARIZE personal data across multiple sources, or personal data that is not covered by the specific email/calendar categories
- general: Any general question related to Facts or questions not related to the personal data stored (email, calandar events, music tastes, github data)

Respond with ONLY the category name, nothing else.`;

const VALID_INTENTS = [
  "calendar_agent",
  "calendar_rag",
  "email_draft",
  "email_reply",
  "email_read",
  "rag",
];

export async function routeIntent(
  message,
  conversationId = null,
  userId = null,
  llmProvider = "OpenAI",
  model = null,
) {
  try {
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: message },
    ];
    const response = await llm.generateResponse(
      llmProvider,
      messages,
      userId ?? parseInt(process.env.SYNC_USER_ID, 10),
      conversationId ?? "intent_router",
      {
        invocationType: LLM_INVOCATION_TYPES.INTENT_ROUTER,
        temperature: 0,
        maxTokens: 20,
      },
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
