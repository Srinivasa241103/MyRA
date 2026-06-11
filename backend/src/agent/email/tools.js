// implement tools for the LLM brain to handle
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { GoogleAuthService } from '../../service/oauth/googleOAuthService.js';
import { google } from "googleapis";
import * as z from "zod";

const llm = new ChatAnthropic({
    model: process.env.ANTHROPIC_CHAT_MODEL,
    temperature: parseFloat(process.env.ANTHROPIC_MODEL_TEMP),
    maxTokens: Number(process.env.ANTHROPIC_MAX_TOKENS),
    maxRetries: 2,
    timeout: 30000,
    streaming: false,
})

const authService = new GoogleAuthService();

const getGmailClient = async () => {
    const userId = parseInt(process.env.SYNC_USER_ID, 10);
    const accessToken = await authService.getValidAccessToken(userId, "gmail");
    authService.oauth2Client.setCredentials({ access_token: accessToken });
    return google.gmail({ version: "v1", auth: authService.oauth2Client });
};

export const draftMail = tool(async ({
    userQuery,
    mode = "new",
    recipient: { name = '', email = '' } = {},
    threadContent = "",
    previousDraft: { subject: prevSubject = '', body: prevBody = '' } = {},
    feedBack = ""
}) => {
    const isRevision = Boolean(mode === "reply");;

    const recipientLine = name
        ? `${name}${email ? ` <${email}>` : ""}`
        : (email || "(recipient not specified)");

    const threadBlock = threadContent
        ? `\nEMAIL THREAD CONTEXT (write a reply that fits this conversation):\n---\n${threadContent}\n---\n`
        : "";

    const revisionBlock = isRevision
        ? `\nPREVIOUS DRAFT:\nSubject: ${prevSubject}\n${prevBody}\n\nUSER FEEDBACK ON THE PREVIOUS DRAFT:\n${feedBack}\n\nRevise the draft above to address this feedback.`
        : "";

    const systemPrompt = `You are an assistant drafting an email on behalf of the user.
        Write only the email content - no commentary, no explanation, no meta-text.
        The body should be plain text (no HTML, no markdown).
        Return ONLY a valid JSON object in the form: { "subject": "<subject line>", "body": "<full email body>" }
        No preamble, no explanation, no markdown code fences.`;

    const userPrompt = `Draft an email based on the following request:

        REQUEST: ${userQuery}

        RECIPIENT: ${recipientLine}
        ${threadBlock}${revisionBlock}

        Return ONLY the JSON object: { "subject": "...", "body": "..." }`;

    const draftResponse = await llm.invoke([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
    ]);

    const cleaned = draftResponse.content.replace(/```json|```/g, "").trim();

    let draft;
    try {
        draft = JSON.parse(cleaned);
    } catch {
        throw new Error(`Failed to parse draft JSON from model output: ${cleaned.slice(0, 200)}`);
    }

    return {
        subject: draft.subject,
        body: draft.body,
    };
}, {
    name: "draft_email",
    description: "Create an Email draft based on the given input for the user.",
    schema: z.object({
        userQuery: z.string()
            .describe("The user's drafting instruction, e.g. 'Ask for a deadline exetension'"),

        mode: z.enum(["new", "reply"])
            .describe("new = fresh mail, reply = response to an email thread"),

        recipient: z.object({
            name: z.string(),
            email: z.string()
        }).nullable()
            .describe("Resolve recipients for a new mail. Null for replies."),

        threadContent: z.string().nullable()
            .describe("Text of the thread being replied to. Content only, never thread/message IDs."),

        originalSubject: z.string().nullable()
            .describe("The subject of the Email being replied to"),

        previousDraft: z.object({
            subject: z.string(),
            body: z.string()
        }).nullable()
            .describe("The prior draft, when regenerating after feedback."),

        feedback: z.string().nullable()
            .describe("User's change requests for regeneration. Null on first draft."),
    }),
});

const fetchRecipientMailId = tool(async ({
    recipientName,
}) => {
    // call the DB function for getting the recipient list 

}, {
    name: "fetch_recipient_mailId_list",
    description: "Fetches the recipient name and mail ID from the user's contact list based on the user input for recipient name",
    schema: z.object.apply({
        recipientName: z.string().describe("Recipient name to search in the user's contacts"),
    }),
});

export const retrieveReplyMailThread = tool(({ }) => { }, {
    name: "retrieve_reply_mail_thread",
    description: "Retrieves the reply mail thread from the user's contacts based on the user input for recipient name",
    schema: z.object.apply({
        emailId: z.string().describe("Email ID"),
    }),
});

export const sendMail = tool(async ({
    to,
    cc = [],
    bcc = [],
    subject,
    body,
    threadId = null,
    inReplyTo = null,
    references = null,
}) => {
    try {
        if (!to || to.length === 0) {
            throw new Error("Cannot send email: no recipients specified");
        }

        const gmail = await getGmailClient();
        const raw = buildRawEmail({
            to,
            cc,
            bcc,
            subject,
            body,
            inReplyTo,
            references,
        });

        const requestBody = { raw };
        if (threadId) requestBody.threadId = threadId;

        const response = await gmail.users.messages.send({
            userId: "me",
            requestBody,
        });

        return {
            success: true,
            messageId: response.data.id,
            threadId: response.data.threadId,
        };
    } catch (err) {
        console.error("[gmailSendService.sendEmail] Error:", err.message);

        const status =
            err.code || err.status || (err.response && err.response.status);
        return {
            success: false,
            error: err.message,
            errorCode: status,
            retryable: status === 429 || status === 500 || status === 503,
        };
    }
}, {
    name: "send_email",
    description: "Sends an email to the specified recipient.",
    schema: z.object({
        to: z.array(z.string())
            .optional()
            .describe("Array of recipient email addresses"),
        cc: z.array(z.string())
            .optional()
            .describe("Array of CC email addresses"),
        bcc: z.array(z.string())
            .optional()
            .describe("Array of BCC email addresses"),
        subject: z.string()
            .optional()
            .describe("Email subject"),
        body: z.string()
            .optional()
            .describe("Email body"),
        threadId: z.string()
            .optional()
            .describe("Thread ID for threading"),
        inReplyTo: z.string()
            .optional()
            .describe("In-reply-to header"),
        references: z.string()
            .optional()
            .describe("References header"),
    })
});

export const presentToUser = tool(async ({ }) => { }, {
    name: "present_to_user",
    description: "Presents the email to the user for approval.",
    schema: z.object({
        subject: z.string()
            .optional()
            .describe("Email subject"),
        body: z.string()
            .optional()
            .describe("Email body"),
    })
});

export const logEmail = tool(async ({ }) => { }, {
    name: "log_email",
    description: "Logs the email action to the database.",
    schema: z.object({
        emailId: z.string()
            .optional()
            .describe("Email ID"),
        threadId: z.string()
            .optional()
            .describe("Thread ID for threading"),
    })
});

export const emailTools = [draftMail, fetchRecipientMailId, retrieveReplyMailThread, sendMail, presentToUser, logEmail];
