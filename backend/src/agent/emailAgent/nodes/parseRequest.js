import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { isValidEmail } from "../tools.js";

const parseRequestSchema = z.object({
    recipient_name: z.string().nullable(),
    recipient_email: z.string().nullable(),
    tone: z.string().nullable(),
    purpose: z.string().nullable(),
});

const parseModel = new ChatOpenAI({
    model: process.env.OPENAI_LIGHT_MODEL,
    temperature: 0,
}).withStructuredOutput(parseRequestSchema);

const normalizeOptionalText = (value) => {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    if (!normalized || ["null", "undefined", "none", "n/a"].includes(normalized.toLowerCase())) {
        return null;
    }
    return normalized;
};

const parseRequest = async (state) => {
    const userPrompt = state.user_prompt.trim();
    const explicitEmail = userPrompt.match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/)?.[0]
        ?? null;

    const response = await parseModel.invoke([
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
    ]);

    return {
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
