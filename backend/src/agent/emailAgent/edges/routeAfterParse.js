import { END } from "@langchain/langgraph";

/**
 * Conditional edge — runs after parseEmailIntent on every turn.
 *
 * Two routing modes:
 *
 * 1. Review mode (status === 'reviewing'):
 *    User has responded to the draft approval card.
 *    Route based on feedbackClassification set by parseEmailIntent.
 *
 * 2. Normal mode:
 *    User is composing or continuing composition.
 *    Route based on intent and current state.
 */
const routeAfterParse = (state) => {
  // Error from parseEmailIntent: end the turn
  if (state.status === "error") {
    return END;
  }

  // Review mode: route based on user's feedback on the draft
  if (state.status === "reviewing") {
    switch (state.feedbackClassification) {
      case "approve":
        return "sendOrSaveDraft";
      case "edit":
        return "applyEdits";
      case "regenerate":
        return "generateDraft";
      case "cancel":
        return "cancelEmail";
      default:
        // Unrecognised feedback — ask the user to clarify
        return "clarifyMissing";
    }
  }

  // Ambiguity resolution: user has answered which email they meant
  // ambiguousFields still set means we need to re-run resolveReplyContext
  if (
    state.emailDetails.isReply &&
    state.ambiguousFields &&
    state.ambiguousFields.length > 0
  ) {
    return "resolveReplyContext";
  }

  // Normal mode: replies need context resolution first
  if (state.emailDetails.isReply) {
    return "resolveReplyContext";
  }

  return "checkRequiredFields";
};

export { routeAfterParse };
