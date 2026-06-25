import { ReducedValue, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

const recipientSchema = z.object({
    name: z.string().default(""),
    email: z.string(),
});

const draftSchema = z.object({
    subject: z.string(),
    body: z.string(),
    version: z.number(),
});

const appendValues = (current, incoming) => {
    if (incoming === undefined || incoming === null) return current;
    return current.concat(Array.isArray(incoming) ? incoming : [incoming]);
};

const emailAgentState = new StateSchema({
    user_prompt: z.string().default(""),
    original_user_request: z.string().default(""),
    purpose: z.string().nullable().default(null),
    tone: z.string().nullable().default(null),

    recipient_name: z.string().nullable().default(null),
    recipient_email_from_request: z.string().nullable().default(null),
    recipient_candidates: z.array(recipientSchema).default(() => []),
    chosen_recipient: recipientSchema.nullable().default(null),
    recipient_lookup_error: z.string().nullable().default(null),

    current_draft: draftSchema.nullable().default(null),
    previous_draft: draftSchema.nullable().default(null),
    draft_history: new ReducedValue(
        z.array(draftSchema).default(() => []),
        {
            inputSchema: z.union([draftSchema, z.array(draftSchema)]),
            reducer: appendValues,
        }
    ),
    edit_instructions: new ReducedValue(
        z.array(z.string()).default(() => []),
        {
            inputSchema: z.union([z.string(), z.array(z.string())]),
            reducer: appendValues,
        }
    ),
    user_feedback: z.string().nullable().default(null),

    approval_status: z
        .enum([
            "not_started",
            "awaiting_review",
            "revision_requested",
            "approved",
            "cancelled",
        ])
        .default("not_started"),

    send_status: z
        .enum([
            "not_started",
            "pending_revoke",
            "revoked",
            "cancelled",
            "sending",
            "sent",
            "failed",
        ])
        .default("not_started"),
    approval_timestamp: z.string().nullable().default(null),
    revoke_deadline: z.string().nullable().default(null),
    pending_send_token: z.string().nullable().default(null),
    message_id: z.string().nullable().default(null),
    thread_id: z.string().nullable().default(null),

    cancelled: z.boolean().default(false),
    last_error: z.string().nullable().default(null),
    final_response: z.string().nullable().default(null),
});

export { draftSchema, emailAgentState, recipientSchema };
