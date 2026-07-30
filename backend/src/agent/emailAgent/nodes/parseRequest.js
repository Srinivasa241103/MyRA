import { z } from "zod";
import { isValidEmail } from "../tools.js";
import LLMService from "../../../RAG/query/llmService.js";
import { LLM_INVOCATION_TYPES } from "../../../utils/constants.js";

const llmService = new LLMService();

const parseRequestSchema = z.object({
    recipient_name: z.string().nullable(),
    recipient_email: z.string().nullable(),
    tone: z.string().nullable(),
    purpose: z.string().nullable(),
});

const normalizeOptionalText = (value) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    if (!normalized || ["null", "undefined", "none", "n/a"].includes(normalized.toLowerCase())) {
        return null;
    }
    return normalized;
};

const parseRequest = async (state, config) => {
    const userPrompt = state.user_prompt.trim();
    const explicitEmail = userPrompt.match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/)?.[0]
        ?? null;

    const response = await llmService.generateStructuredResponse({
        llmProvider: state.llm_provider ?? config?.configurable?.llmProvider ?? "OpenAI",
        model: state.llm_model ?? config?.configurable?.model ?? process.env.OPENAI_LIGHT_MODEL,
        schema: parseRequestSchema,
        userId: config?.configurable?.user_id ?? parseInt(process.env.SYNC_USER_ID, 10),
        conversationId: config?.configurable?.thread_id ?? "email_agent_parse",
        invocationType: LLM_INVOCATION_TYPES.EMAIL_AGENT,
        temperature: 0,
        messages: [
        {
            role: "system",
            content: `Extract email-writing details from the user's request.

Return:
- recipient_name: the person's name, or null
- recipient_email: an explicitly provided email address, or null
- tone: the requested tone, or null
- purpose: a concise description of what the email should communicate, or null

Do not invent names, email addresses, or facts.`,
        },
        {
            role: "user",
            content: userPrompt,
        },
        ],
    });

    return {
        llm_provider: state.llm_provider ?? config?.configurable?.llmProvider ?? "OpenAI",
        llm_model: state.llm_model ?? config?.configurable?.model ?? process.env.OPENAI_LIGHT_MODEL,
        original_user_request: userPrompt,
        recipient_name: normalizeOptionalText(response.recipient_name),
        recipient_email_from_request: isValidEmail(response.recipient_email)
            ? response.recipient_email.trim()
            : explicitEmail,
        tone: normalizeOptionalText(response.tone),
        purpose: normalizeOptionalText(response.purpose) || userPrompt,
        last_error: null,
    };
};

export { parseRequest };
