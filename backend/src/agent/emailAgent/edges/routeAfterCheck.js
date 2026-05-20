import { END } from "@langchain/langgraph";

/**
 * Conditional edge — runs after checkRequiredFields.
 *
 * Simple two-way route:
 *  - Missing fields or still clarifying → clarifyMissing
 *  - All fields present → generateDraft
 */
const routeAfterCheck = (state) => {
  if (state.status === "error") return END;

  if (state.status === "clarifying") {
    return "clarifyMissing";
  }

  if (state.missingFields && state.missingFields.length > 0) {
    return "clarifyMissing";
  }

  return "generateDraft";
};

export { routeAfterCheck };
