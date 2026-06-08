import { replyContextService } from "../../../service/email/replyContextService.js";
import { mergeOriginalEmail, appendError } from "../state.js";

const CONFIDENCE_THRESHOLD = 0.7;
const AMBIGUITY_DELTA = 0.05;

/**
 * Searches the Gmail vector store to find the email the user wants to reply to.
 * Only runs when intent === 'email_reply'.
 *
 * Three outcomes:
 *  1. Confident match  → populate originalEmail in state, continue to checkRequiredFields
 *  2. Ambiguous match  → surface both candidates, ask user to disambiguate
 *  3. No match / low confidence → ask user to describe the email more specifically
 */
const resolveReplyContext = async (state) => {
  const { replyReference } = state.emailDetails;
  const { userId } = state;

  if (!replyReference) {
    // No reference phrase yet — checkRequiredFields will catch this
    return { status: "resolving" };
  }

  try {
    const result = await replyContextService.findOriginalEmail(replyReference, userId);

    // ── Ambiguous: two results too close in score ─────────────────────────────
    if (
      result.candidates.length >= 2 &&
      result.candidates[0].score - result.candidates[1].score < AMBIGUITY_DELTA
    ) {
      return {
        status: "clarifying",
        ambiguousFields: ["replyReference"],
        replyContextCandidates: result.candidates.slice(0, 2),
        agentResponse: buildAmbiguityMessage(result.candidates.slice(0, 2)),
      };
    }

    // ── Low confidence: no clear match ───────────────────────────────────────
    if (
      !result.candidates.length ||
      result.candidates[0].score < CONFIDENCE_THRESHOLD
    ) {
      return {
        status: "clarifying",
        ambiguousFields: ["replyReference"],
        replyContextCandidates: [],
        agentResponse:
          `I couldn't find that email in your inbox. Could you describe it a bit more — ` +
          `for example, who sent it or roughly when?`,
      };
    }

    // ── Confident match ───────────────────────────────────────────────────────
    const match = result.candidates[0];

    const updatedOriginalEmail = mergeOriginalEmail(state.originalEmail, {
      messageId: match.messageId,
      threadId: match.threadId,
      from: match.from,
      subject: match.subject,
      bodyPreview: match.bodyPreview,
      timestamp: match.timestamp,
      inReplyTo: match.messageId,
      references: match.references || match.messageId,
    });

    return {
      status: "resolving",
      originalEmail: updatedOriginalEmail,
      ambiguousFields: [],
      replyContextCandidates: [],
    };
  } catch (err) {
    console.error("[resolveReplyContext] Error:", err.message);

    const updatedErrors = appendError(state.errors, {
      node: "resolveReplyContext",
      message: err.message,
      retryable: true,
    });

    return {
      status: "error",
      errors: updatedErrors,
      agentResponse:
        "I had trouble searching your inbox. Please try again in a moment.",
    };
  }
};

const buildAmbiguityMessage = (candidates) => {
  const list = candidates
    .map((c, i) => {
      const date = c.timestamp
        ? new Date(c.timestamp).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })
        : "unknown date";
      return `${i + 1}. From ${c.from} — "${c.subject}" (${date})`;
    })
    .join("\n");

  return `I found a few emails that could match. Which one did you mean?\n\n${list}`;
};

export { resolveReplyContext };
