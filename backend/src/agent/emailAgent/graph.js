import { StateGraph, START, END } from "@langchain/langgraph";
import { INITIAL_STATE, mergeEmailDetails, mergeOriginalEmail } from "./state.js";

// ── Nodes ─────────────────────────────────────────────────────────────────────
import { parseEmailIntent } from "./nodes/parseEmailIntent.js";
import { resolveReplyContext } from "./nodes/resolveReplyContext.js";
import { checkRequiredFields } from "./nodes/checkRequiredFields.js";
import { clarifyMissing } from "./nodes/clarifyMissing.js";
import { generateDraft } from "./nodes/generateDraft.js";
import { presentDraftForApproval } from "./nodes/presentDraftForApproval.js";
import { applyEdits } from "./nodes/applyEdits.js";
import { sendOrSaveDraft } from "./nodes/sendOrSaveDraft.js";

// ── Edges ─────────────────────────────────────────────────────────────────────
import { routeAfterParse } from "./edges/routeAfterParse.js";
import { routeAfterCheck } from "./edges/routeAfterCheck.js";

// ── Cancel handler ────────────────────────────────────────────────────────────
const cancelEmail = async () => ({
  status: "cancelled",
  agentResponse: {
    type: "cancelled",
    message: "Email cancelled. Let me know if you want to start a new one.",
  },
});

// ── Channel definitions ────────────────────────────────────────────────────────
// value(x, y): x = current stored value, y = update returned by node
// y ?? x: keep current value when node does not return this field

const channels = {
  userMessage: { value: (x, y) => y ?? x, default: () => null },
  conversationId: { value: (x, y) => y ?? x, default: () => null },
  intent: { value: (x, y) => y ?? x, default: () => null },
  status: { value: (x, y) => y ?? x, default: () => "idle" },
  mode: { value: (x, y) => y ?? x, default: () => "save_draft" },
  _userRequestedSend: { value: (x, y) => y ?? x, default: () => false },

  // Deep merge — never replace wholesale
  emailDetails: {
    value: (x, y) =>
      y !== undefined && y !== null ? mergeEmailDetails(x, y) : x,
    default: () => ({ ...INITIAL_STATE.emailDetails }),
  },
  originalEmail: {
    value: (x, y) =>
      y !== undefined && y !== null ? mergeOriginalEmail(x, y) : x,
    default: () => ({ ...INITIAL_STATE.originalEmail }),
  },

  // Recomputed arrays — overwrite each time
  missingFields: { value: (x, y) => y ?? x, default: () => [] },
  ambiguousFields: { value: (x, y) => y ?? x, default: () => [] },
  replyContextCandidates: { value: (x, y) => y ?? x, default: () => [] },

  // Accumulating arrays — nodes return full updated arrays via appendDraft/appendError
  draftHistory: {
    value: (x, y) => (y !== undefined && y !== null ? y : x),
    default: () => [],
  },
  errors: {
    value: (x, y) => (y !== undefined && y !== null ? y : x),
    default: () => [],
  },

  userFeedback: { value: (x, y) => y ?? x, default: () => null },
  feedbackClassification: { value: (x, y) => y ?? x, default: () => null },
  editInstruction: { value: (x, y) => y ?? x, default: () => null },
  agentResponse: { value: (x, y) => y ?? x, default: () => null },

  sentMessageId: { value: (x, y) => y ?? x, default: () => null },
  savedDraftId: { value: (x, y) => y ?? x, default: () => null },
};

// ── Graph builder ─────────────────────────────────────────────────────────────

const buildEmailAgentGraph = (checkpointer) => {
  const workflow = new StateGraph({ channels });

  // Register nodes
  workflow.addNode("parseEmailIntent", parseEmailIntent);
  workflow.addNode("resolveReplyContext", resolveReplyContext);
  workflow.addNode("checkRequiredFields", checkRequiredFields);
  workflow.addNode("clarifyMissing", clarifyMissing);
  workflow.addNode("generateDraft", generateDraft);
  workflow.addNode("presentDraftForApproval", presentDraftForApproval);
  workflow.addNode("applyEdits", applyEdits);
  workflow.addNode("sendOrSaveDraft", sendOrSaveDraft);
  workflow.addNode("cancelEmail", cancelEmail);

  // Entry point — always starts at parseEmailIntent
  workflow.addEdge(START, "parseEmailIntent");

  // After parse: conditional based on status and intent
  workflow.addConditionalEdges("parseEmailIntent", routeAfterParse);

  // After resolveReplyContext: clarify if ambiguous, else validate
  workflow.addConditionalEdges("resolveReplyContext", (state) => {
    if (state.status === "error") return END;
    if (state.status === "clarifying") return "clarifyMissing";
    return "checkRequiredFields";
  });

  // After checkRequiredFields: missing fields or generate
  workflow.addConditionalEdges("checkRequiredFields", routeAfterCheck);

  // Terminal edges
  workflow.addEdge("clarifyMissing", END);
  workflow.addEdge("generateDraft", "presentDraftForApproval");
  workflow.addEdge("presentDraftForApproval", END);
  workflow.addEdge("applyEdits", "presentDraftForApproval");
  workflow.addEdge("sendOrSaveDraft", END);
  workflow.addEdge("cancelEmail", END);

  return workflow.compile({ checkpointer });
};

export { buildEmailAgentGraph };
