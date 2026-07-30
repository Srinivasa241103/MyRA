import { z } from "zod";
import RecipientRepository from "../../database/recipientRepository.js";
import { sendEmail } from "../../service/email/gmailSendService.js";
import LLMService from "../../RAG/query/llmService.js";
import { LLM_INVOCATION_TYPES } from "../../utils/constants.js";

const recipientRepo = new RecipientRepository();
const llmService = new LLMService();

const draftOutputSchema = z.object({
    subject: z.string().min(1),
    body: z.string().min(1),
});

const isValidEmail = (value) => {
    if (typeof value !== "string") return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
};

const searchRecipients = async ({ userId, recipientName }) => {
    if (!userId || !recipientName?.trim()) return [];

    const recipients = await recipientRepo.getRelavantRecipient(
        userId,
        recipientName.trim()
    );

    return recipients
        .filter(recipient => isValidEmail(recipient.email))
        .map(recipient => ({
            name: recipient.name?.trim() ?? "",
            email: recipient.email.trim(),
        }));
};

const createEmailDraft = async ({
    userPrompt,
    purpose,
    tone,
    recipient,
    previousDraft,
    feedback,
    llmProvider,
    model,
    userId,
    conversationId,
}) => {
    const revisionContext = previousDraft
        ? `Previous draft:
Subject: ${previousDraft.subject}
Body:
${previousDraft.body}

Requested changes:
${feedback}`
        : "This is the first draft.";

    return llmService.generateStructuredResponse({
        llmProvider: llmProvider ?? "OpenAI",
        model: model ?? process.env.OPENAI_LIGHT_MODEL,
        schema: draftOutputSchema,
        userId,
        conversationId,
        invocationType: LLM_INVOCATION_TYPES.EMAIL_AGENT,
        temperature: 0.3,
        messages: [
        {
            role: "system",
            content: `Write a clear plain-text email for the user.

Return a subject and body only through the required structured output.
Do not include markdown, commentary, or sending instructions.
Preserve the user's intent and do not invent important facts.
When revising, apply the requested changes to the previous draft.`,
        },
        {
            role: "user",
            content: `Original request: ${userPrompt}
Purpose: ${purpose || userPrompt}
Tone: ${tone || "professional"}
Recipient: ${recipient.name || recipient.email} <${recipient.email}>

${revisionContext}`,
        },
        ],
    });
};

const sendApprovedEmail = async ({
    userId,
    recipient,
    draft,
    threadId = null,
}) => {
    return sendEmail({
        userId,
        to: [recipient.email],
        subject: draft.subject,
        body: draft.body,
        threadId,
    });
};

export {
    createEmailDraft,
    isValidEmail,
    searchRecipients,
    sendApprovedEmail,
};
