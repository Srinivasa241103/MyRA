/**
 * Email agent entry point.
 *
 * Compiles the LangGraph and exposes three functions for ChatController:
 *   invokeEmailAgent      — run one turn
 *   hasActiveEmailSession — check if conversation has an ongoing session
 *   getEmailSessionState  — read current checkpointed state
 *
 * Uses the same PostgreSQL checkpointer as the calendar agent.
 * Adjust the import path to match your checkpointer config location.
 */
import { MemorySaver } from "@langchain/langgraph";
import { buildEmailAgentGraph } from "./graph.js";
import { getLatestDraft } from "./state.js";

// Compile once at module load — reused across all requests
const emailAgentGraph = buildEmailAgentGraph(new MemorySaver());

// Statuses that mean the session is finished — no need to resume
const TERMINAL_STATUSES = ["sent", "saved_draft", "cancelled", "idle"];

/**
 * Runs one turn of the email agent for the given conversation.
 *
 * @param {string} userMessage    — current user message
 * @param {string} conversationId — used as the checkpointer thread key
 * @param {string|null} intent    — 'email_draft' | 'email_reply' | null (when resuming)
 * @param {number|null} userId    — owning user, threaded down to reply-context retrieval
 * @returns {object} finalState   — complete state after this turn
 */
const invokeEmailAgent = async (userMessage, conversationId, intent, userId = null) => {
  const config = {
    configurable: {
      thread_id: `email_${conversationId}`,
    },
  };

  // Only pass intent on the first turn — subsequent turns read it from checkpointed state
  const input = {
    userMessage,
    conversationId,
    userId,
    ...(intent ? { intent } : {}),
  };

  const finalState = await emailAgentGraph.invoke(input, config);
  return finalState;
};

/**
 * Returns the checkpointed state for a conversation, or null if none exists.
 */
const getEmailSessionState = async (conversationId) => {
  try {
    const config = {
      configurable: {
        thread_id: `email_${conversationId}`,
      },
    };

    const state = await emailAgentGraph.getState(config);
    return state && state.values ? state.values : null;
  } catch {
    return null;
  }
};

/**
 * Returns true if this conversation has an active, incomplete email session.
 * Used by ChatController to bypass the intent router for ongoing sessions.
 */
const hasActiveEmailSession = async (conversationId) => {
  const sessionState = await getEmailSessionState(conversationId);
  if (!sessionState) return false;
  return !TERMINAL_STATUSES.includes(sessionState.status);
};

export {
  invokeEmailAgent,
  getEmailSessionState,
  hasActiveEmailSession,
  getLatestDraft,
};
