import { StateSchema, ReducedValue, MessageValue } from "@langchain/langgraph";
import { z } from "zod";

export const emailAgentState = new StateSchema({
    messages: MessageValue,

    intent: z.string().nullable().default(null),
    mode: z.enum(["save_draft", "send"]).default("save_draft"),

    recipientQuery: z.string().nullable().default(null),
    recipientCandidates: z.array(z.any()).default(() => []),
    resolvedRecipient: z.object({ name: z.string(), email: z.string() }).nullable().default(null),

    replyCandidates: z.array(z.any()).default(() => []),
    threadId: z.string().nullable().default(null),
    messageId: z.string().nullable().default(null),
    threadContent: z.string().nullable().default(null),

    currentDraft: z
        .object({ subject: z.string(), body: z.string() })
        .nullable()
        .default(null),
    previousDraft: z
        .object({ subject: z.string(), body: z.string() })
        .nullable()
        .default(null),

    bodyHints: new ReducedValue(
        z.array(z.string()).default(() => []),
        {
            inputSchema: z.string(),
            reducer: (current, next) => [...current, next],
        }
    ),

    draftVersion: z.number().default(0),

    pendingSelection: z
        .enum(["recipient", "replyTarget"])
        .nullable()
        .default(null),
    _userRequestedSend: z.boolean().default(false),
    approvalStatus: z
        .enum(["pending", "approved", "rejected"])
        .default("pending"),
})