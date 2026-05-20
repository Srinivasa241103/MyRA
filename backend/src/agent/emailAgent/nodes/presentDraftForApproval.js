import { getLatestDraft } from "../state.js";

/**
 * Formats the latest draft as a structured approval payload for the frontend.
 * Always ends the turn — waits for user to respond via the approval card.
 *
 * The frontend reads agentResponse.type === 'draft_approval' and renders
 * the draft card with action buttons: approve, edit, regenerate, cancel.
 */
const presentDraftForApproval = async (state) => {
  const latestDraft = getLatestDraft(state.draftHistory);

  if (!latestDraft) {
    return {
      status: "error",
      agentResponse:
        "Something went wrong — no draft was generated. Please try again.",
    };
  }

  const { emailDetails, draftHistory } = state;

  const toLine = emailDetails.to
    .map((r) => (r.name ? `${r.name} <${r.email || "?"}>` : r.email))
    .join(", ");

  const approvalPayload = {
    type: "draft_approval",

    draft: {
      version: latestDraft.version,
      subject: latestDraft.subject,
      body: latestDraft.body,
      generatedAt: latestDraft.generatedAt,
      source: latestDraft.source,
    },

    meta: {
      to: toLine,
      cc: emailDetails.cc.map((r) => r.email || r.name).join(", ") || null,
      tone: emailDetails.tone,
      isReply: emailDetails.isReply,
      totalVersions: draftHistory.length,
      mode: state.mode,
    },

    actions: ["approve", "edit", "regenerate", "cancel"],

    instructions:
      `Version ${latestDraft.version}. ` +
      `Reply with: "approve" to save${state._userRequestedSend ? " and send" : ""}, ` +
      `"edit: <your changes>" to modify, ` +
      `"regenerate" for a new version, or "cancel" to stop.`,
  };

  return {
    status: "reviewing",
    agentResponse: approvalPayload,
  };
};

export { presentDraftForApproval };
