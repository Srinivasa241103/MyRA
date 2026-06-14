import { emailAgent } from "./graph.js";
import { Command } from "@langchain/langgraph";

const TERMINAL_STATUSES = ["sent", "saved_draft", "cancelled", "idle"];

const invokeEmailAgent = async (userMessage, conversationId, intent, userId = null) => {
    const config = {
        configurable: {
            thread_id: `email_${conversationId}`,
            user_id: userId
        }
    };

    const input = {
        userMessage,
        conversationId,
        userId,
        ...(intent ? { intent } : {}),
    };

    const finalState = await emailAgent.invoke(input, config);
    return finalState;
};

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

const hasActiveEmailSession = async (conversationId) => {
    const sessionState = await getEmailSessionState(conversationId);
    if (!sessionState) return false;
    return !TERMINAL_STATUSES.includes(sessionState.status);
};

export { invokeEmailAgent, getEmailSessionState, hasActiveEmailSession };
