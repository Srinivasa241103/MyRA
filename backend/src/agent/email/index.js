import { emailAgent } from "./graph.js";
import { Command } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";

const TERMINAL_STATUSES = ["sent", "saved_draft", "cancelled", "idle", "complete"];

/**
 * Runs one turn of the email agent.
 *
 * - First turn  : passes a HumanMessage into state.messages + optional intent
 * - Resume turns: wraps the user's decision in Command({ resume }) so LangGraph
 *                 delivers it to the waiting interrupt() call
 *
 * Returns: { agentResponse, emailResponse?, status }
 *   agentResponse — string or structured object for the frontend
 *   emailResponse — draft_approval payload when the graph is paused (null otherwise)
 *   status        — "interrupted" | "complete"
 */
const invokeEmailAgent = async (userMessage, conversationId, intent, userId = null, resumeValue = null) => {
    const config = {
        configurable: {
            thread_id: `email_${conversationId}`,
            user_id: userId,
        },
    };

    // Resume turn: user answered an interrupt (approve / pick / feedback)
    // New turn   : fresh human message starting or continuing the task
    const input = resumeValue
        ? new Command({ resume: resumeValue })
        : {
              messages: [new HumanMessage(userMessage)],
              userId,
              ...(intent ? { intent } : {}),
          };

    // Use stream() so we get the final state values AND can detect interrupts.
    // invoke() swallows interrupt signals — never use it for HITL graphs.
    let finalState = null;
    for await (const event of await emailAgent.stream(input, {
        ...config,
        streamMode: "values",
    })) {
        finalState = event;
    }

    // After streaming, check whether the graph suspended at an interrupt node
    const currentState = await emailAgent.getState(config);
    const interrupts = currentState?.tasks?.[0]?.interrupts ?? [];

    if (interrupts.length > 0) {
        const interruptPayload = interrupts[0].value;
        return {
            agentResponse: buildInterruptResponse(interruptPayload),
            emailResponse: interruptPayload.type === "draft_approval" ? buildDraftApprovalPayload(interruptPayload) : null,
            status: "interrupted",
        };
    }

    // Graph ran to completion — surface the last AI message
    const lastMsg = finalState?.messages?.at(-1);
    return {
        agentResponse: lastMsg?.content ?? "",
        emailResponse: null,
        status: "complete",
    };
};

/**
 * Builds the human-readable / UI payload shown while the graph is paused.
 */
function buildInterruptResponse(payload) {
    if (payload.type === "draft_approval") {
        // Return the structured object — chatStore's normalizeEmailResponse
        // will detect type === "draft_approval" and render the card.
        return buildDraftApprovalPayload(payload);
    }

    // Recipient / reply-target selection: return a plain string prompt
    const candidates = (payload.candidates ?? [])
        .map((c, i) => `${i + 1}. ${c.name ? `${c.name} <${c.email}>` : c.email ?? JSON.stringify(c)}`)
        .join("\n");
    return `${payload.prompt ?? "Please make a selection:"}\n\n${candidates}`;
}

/**
 * Shapes the draft_approval payload to match what ChatWindow's DraftApprovalCard expects.
 */
function buildDraftApprovalPayload(payload) {
    return {
        type: "draft_approval",
        draft: {
            subject: payload.draft?.subject ?? "",
            body: payload.draft?.body ?? "",
            version: 1,
            source: "agent",
        },
        meta: {
            to: payload.meta?.to ?? null,
            cc: null,
            tone: "professional",
            totalVersions: 1,
        },
        instructions: payload.instructions ?? 'Reply "approve" to send, "edit: <changes>" to revise, or "cancel" to stop.',
    };
}

/**
 * Returns the full checkpointed state for a conversation, or null.
 */
const getEmailSessionState = async (conversationId) => {
    try {
        const config = {
            configurable: {
                thread_id: `email_${conversationId}`,
            },
        };
        const state = await emailAgent.getState(config);
        return state && state.values ? state.values : null;
    } catch {
        return null;
    }
};

/**
 * Returns true when this conversation has an active, incomplete email session.
 * Used by ChatController to bypass the intent router for ongoing sessions.
 *
 * A session is active if:
 *   - The graph is paused at an interrupt (tasks with interrupts), OR
 *   - The graph still has pending nodes to execute (next is non-empty)
 */
const hasActiveEmailSession = async (conversationId) => {
    try {
        const config = {
            configurable: { thread_id: `email_${conversationId}` },
        };
        const state = await emailAgent.getState(config);
        if (!state) return false;

        // Paused at interrupt
        const hasInterrupt = (state.tasks?.[0]?.interrupts?.length ?? 0) > 0;
        if (hasInterrupt) return true;

        // Still has pending work
        return (state.next?.length ?? 0) > 0;
    } catch {
        return false;
    }
};

export { invokeEmailAgent, getEmailSessionState, hasActiveEmailSession };
