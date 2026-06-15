import { StateSchema, ReducedValue, MessageValue } from "@langchain/langgraph";
import { z } from "zod";

const emailAgentState = new StateSchema({
    user_prompt: z.string(),
    recipient_name: z.string(),

    recipient_list: z.array(z.string()).default(() => []),
    choosen_recipient: z.string(),

    draft_history: new ReducedValue(
        z.array(z.string()).default(() => []),
        { reducer: (x, y) => x.concat(Array.isArray(y) ? y : [y]) }
    ),

    email_draft: z.string(),

    edit_intstructions: new ReducedValue(
        z.array(z.string()).default(() => []),
        { reducer: (x, y) => x.concat(Array.isArray(y) ? y : [y]) }
    ),

    tone: z.string().default(""),

    approval_status: z.enum(["draft", "approved", "rejected"]).default("draft"),
    email_subject: z.string(),
    revoke: z.boolean().default(false),

    recipient_candidates: new ReducedValue(
        z.array(z.any()).default(() => []),
        { reducer: (x, y) => x.concat(Array.isArray(y) ? y : [y]) }
    ),

    chosen_recipient_email: z.string().nullable().default(null),

    current_draft: z
        .object({ subject: z.string(), body: z.string() })
        .nullable()
        .default(null),

    previous_draft: z
        .object({ subject: z.string(), body: z.string() })
        .nullable()
        .default(null),

    draft_version: z.number().default(0),
    user_feedback: z.string().nullable().default(null),
    send_status: z.enum(["pending", "approved", "revoked", "sent", "failed"]).default("pending"),
    revoke_deadline: z.string().nullable().default(null),
    pending_send_token: z.string().nullable().default(null),
    message_id: z.string().nullable().default(null),
    thread_id: z.string().nullable().default(null),
    thread_content: z.string().nullable().default(null),
    original_user_request: z.string().nullable().default(null),
    approval_timestamp: z.string().nullable().default(null),
})

export { emailAgentState };