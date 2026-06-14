import { END } from "@langchain/langgraph";
/**
 * Conditional edge — runs after the approval interrupt resolves.
 *
 *   approved -> "agent"  (the planner's prompt now permits send_email / save_draft;
 *                         swap this to a dedicated "send" node if you'd rather not
 *                         round-trip through the LLM)
 *   rejected -> "agent"  (the user's feedback is already in bodyHints, so the
 *                         planner re-drafts)
 *
 * Never returns END here — rejection loops back to regenerate. Only a completed
 * send (or an explicit user abort) ends the graph.
 */
const routeAfterApproval = (state) => {
    if (state.aborted) return END;

    if (state.approvalStatus === "approved") {
        return "send";
    }
    return "agent";
};

export { routeAfterApproval };