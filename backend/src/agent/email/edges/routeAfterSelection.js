import { END } from "@langchain/langgraph";

/**
 * Conditional edge — runs after the selection interrupt resolves.
 *   aborted -> END   (user cancelled the pick)
 *   else    -> agent (recipient/thread resolved; back to the planner)
 */
const routeAfterSelection = (state) => {
    if (state.aborted) return END;
    return "agent";
};

export { routeAfterSelection }
