// implement tools for the LLM brain to handle
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { ToolMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { GoogleAuthService } from '../../service/oauth/googleOAuthService.js';
import { google } from "googleapis";
import RecipientRepository from "../../database/recipientRepository.js";
import { logger } from "../../utils/logger.js";
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
const recipientRepo = new RecipientRepository();

const getGmailClient = async () => {
    const userId = parseInt(process.env.SYNC_USER_ID, 10);
    const accessToken = await authService.getValidAccessToken(userId, "gmail");
    authService.oauth2Client.setCredentials({ access_token: accessToken });
    return google.gmail({ version: "v1", auth: authService.oauth2Client });
};

const draftMail = tool(async ({
    userQuery,
    mode = "new",
    recipient: { name = '', email = '' } = {},
    threadContent = "",
    previousDraft: { subject: prevSubject = '', body: prevBody = '' } = {},
    feedback = ""
}, config) => {
    logger.info("draft_email tool has been invoked \n drafting email......");
    // A revision is driven by feedback on a prior draft — independent of new/reply mode.
    const isRevision = Boolean(feedback || prevBody);

    const recipientLine = name
        ? `${name}${email ? ` <${email}>` : ""}`
        : (email || "(recipient not specified)");

    const threadBlock = threadContent
        ? `\nEMAIL THREAD CONTEXT (write a reply that fits this conversation):\n---\n${threadContent}\n---\n`
        : "";

    const revisionBlock = isRevision
        ? `\nPREVIOUS DRAFT:\nSubject: ${prevSubject}\n${prevBody}\n\nUSER FEEDBACK ON THE PREVIOUS DRAFT:\n${feedback}\n\nRevise the draft above to address this feedback.`
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

    const currentDraft = { subject: draft.subject, body: draft.body };

    // Write the draft into graph state and reset the approval gate to "pending"
    // (so routeAfterTool sends control to the approval node — including on re-drafts).
    // A ToolMessage is required so the AI tool_call has a matching tool response.
    return new Command({
        update: {
            currentDraft,
            approvalStatus: "pending",
            messages: [
                new ToolMessage({
                    content: `Draft ready for approval.\nSubject: ${currentDraft.subject}\n\n${currentDraft.body}`,
                    tool_call_id: config.toolCall.id,
                }),
            ],
        },
    });
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

const fetchRecipientMailId = tool(async ({ recipientName }, config) => {
    // userId is supplied by the runtime, not the LLM — same source as getGmailClient.
    const userId = parseInt(process.env.SYNC_USER_ID, 10);

    // NOTE: getRelavantRecipient(userId, userName) — order matters.
    const recipientList = await recipientRepo.getRelavantRecipient(userId, recipientName);
    const cleanedList = recipientList.map(item => ({
        name: item.name,
        email: item.email,
    }));

    // Exactly one match -> resolve directly, no human pick needed.
    if (cleanedList.length === 1) {
        const [recipient] = cleanedList;
        return new Command({
            update: {
                resolvedRecipient: recipient,
                recipientCandidates: [],
                pendingSelection: null,
                messages: [
                    new ToolMessage({
                        content: `Resolved recipient: ${recipient.name} <${recipient.email}>`,
                        tool_call_id: config.toolCall.id,
                    }),
                ],
            },
        });
    }

    // Zero or multiple -> hand to the selection node for a human pick
    // (zero candidates lets the user type a full address in the selection prompt).
    return new Command({
        update: {
            recipientCandidates: cleanedList,
            pendingSelection: "recipient",
            messages: [
                new ToolMessage({
                    content: cleanedList.length
                        ? `Found ${cleanedList.length} matching contacts; awaiting user selection.`
                        : `No contacts matched "${recipientName}"; awaiting a full email address from the user.`,
                    tool_call_id: config.toolCall.id,
                }),
            ],
        },
    });
}, {
    name: "fetch_recipient_mailId_list",
    description: "Looks up candidate contacts for a recipient name from the user's address book. The user is identified by the runtime, so only pass the recipient name.",
    schema: z.object({
        recipientName: z.string().describe("Recipient name to search in the user's contacts"),
    }),
});

// TODO(reply-flow): not implemented. Must search for the target thread and write
// replyCandidates + pendingSelection="replyTarget" (or threadId/threadContent on a
// single match) via a Command, mirroring fetchRecipientMailId. Until then the reply
// path is non-functional.
const retrieveReplyMailThread = tool(async ({ emailId }, config) => {
    return new ToolMessage({
        content: "retrieve_reply_mail_thread is not implemented yet.",
        tool_call_id: config.toolCall.id,
    });
}, {
    name: "retrieve_reply_mail_thread",
    description: "Retrieves the reply mail thread to respond to, based on the user's description of the email.",
    schema: z.object({
        emailId: z.string().describe("Email ID"),
    }),
});

const presentToUser = tool(async ({
    presentationType,
    draft,
    recipients,
    meta,
    message,
}) => {
    // Draft mode: surface an email draft for approval.
    if (presentationType === "draft") {
        const { subject = "", body = "" } = draft ?? {};

        if (!subject && !body) {
            throw new Error("Cannot present draft: subject and body are both empty");
        }

        const m = meta ?? {};

        return {
            type: "draft_approval",
            draft: { subject, body },
            meta: {
                to: m.to ?? null,
                cc: m.cc ?? null,
                isReply: m.isReply ?? false,
            },
            actions: ["approve", "edit", "regenerate", "cancel"],
            instructions:
                message ||
                `Review the draft. Reply with "approve" to send, ` +
                `"edit: <your changes>" to modify, "regenerate" for a new version, ` +
                `or "cancel" to stop.`,
        };
    }

    // Recipient mode: surface contact suggestions for the user to pick from.
    if (presentationType === "recipients") {
        const list = recipients;

        if (list.length === 0) {
            return {
                type: "recipient_suggestions",
                recipients: [],
                actions: ["cancel"],
                instructions:
                    message ||
                    "No matching contacts were found. Reply with the full email address, or \"cancel\" to stop.",
            };
        }

        return {
            type: "recipient_suggestions",
            recipients: list,
            actions: ["select", "cancel"],
            instructions:
                message ||
                `Found ${list.length} matching contact${list.length > 1 ? "s" : ""}. ` +
                `Reply with the name or number of the recipient you meant, or "cancel" to stop.`,
        };
    }

    throw new Error(`present_to_user: unknown presentationType "${presentationType}"`);
}, {
    name: "present_to_user",
    description:
        "Presents something to the user and pauses for their response. Use presentationType='draft' to show an email draft for approval, or presentationType='recipients' to show a list of contact suggestions ({name, email}) for the user to choose from.",
    schema: z.object({
        presentationType: z.enum(["draft", "recipients"])
            .describe("'draft' to present an email draft for approval, 'recipients' to present contact suggestions to choose from"),

        draft: z.object({
            subject: z.string(),
            body: z.string(),
        }).nullable()
            .describe("The email draft to present. Required when presentationType='draft'."),

        recipients: z.array(z.object({
            name: z.string(),
            email: z.string(),
        })).nullable()
            .describe("Recipient suggestions, each as { name, email }. Required when presentationType='recipients'."),

        meta: z.object({
            to: z.string().nullable(),
            cc: z.string().nullable(),
            isReply: z.boolean(),
        }).nullable()
            .describe("Optional draft metadata: formatted to/cc lines and reply flag. Only used for drafts."),

        message: z.string().nullable()
            .describe("Optional custom instruction text shown to the user in place of the default."),
    })
});

const logEmail = tool(async ({ }) => { }, {
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


// Only planning/info tools are bound to the LLM. Sending, saving, draft approval,
// and recipient selection are handled by dedicated graph nodes (sendNode,
// approvalNode, selectionNode) so the model cannot perform irreversible or
// human-gated actions on its own.
const tools = [draftMail, fetchRecipientMailId, retrieveReplyMailThread, presentToUser];
export { tools };