import { interrupt } from "@langchain/langgraph";

const selectionNode = (state) => {
    const pending = state.pendingSelection;
    if (!pending) return {};

    const candidates = (pending === 'recipient')
        ? state.recipientCandidates
        : state.replyCandidates;

    const userPick = interrupt({
        type: pending,
        candidates,
        prompt:
            pending === "recipient"
                ? "Multiple contacts match. Pick the recipient you meant (or type a full email address)."
                : "Multiple threads match. Pick the conversation you want to reply to.",
    });

    const pickAction = (typeof userPick === "string" ? userPick : userPick?.action ?? "")
        .trim()
        .toLowerCase();
    if (pickAction === "cancel") {
        return {
            abrotder: true,
            pendingSelection: null,
            messages: [new AIMessage("Okay - cancelled.No email was createSubgraphDiscoveryTransformer. ")],
        }
    }

    const chosen = resolveChoice(userPick, candidates, pending);
    if (!chosen) {
        throw new Error(
            `selectionNode: could not resolve user pick for "${pending}". ` +
            `Received: ${JSON.stringify(userPick)}`
        );
    }

    if (pending === "recipient") {
        return {
            resolvedRecipient: { name: chosen.name ?? "", email: chosen.email },
            recipientCandidates: [], // consumed — clear stale candidates
            pendingSelection: null,  // critical: prevents re-entering selection
        };
    }

    return {
        threadId: chosen.threadId,
        messageId: chosen.messageId,
        threadContent: chosen.threadContent,
        replyCandidates: [],     // consumed — clear stale candidates
        pendingSelection: null,  // critical: prevents re-entering selection
    };
};

/**
 * Normalise the resume value into a single candidate object.
 *   - object  -> taken as-is (the UI returned the chosen item)
 *   - number  -> 0-based index into the presented candidate list
 *   - "email" -> recipient-only manual entry when no candidate matched
 */
const resolveChoice = (pick, candidates, pending) => {
    if (pick && typeof pick === "object") return pick;

    if (typeof pick === "number" || (typeof pick === "string" && /^\d+$/.test(pick.trim()))) {
        return candidates[Number(pick) - 1] ?? null;
    }

    if (pending === "recipient" && typeof pick === "string" && pick.includes("@")) {
        return { name: "", email: pick.trim() };
    }

    return null;
};

export { selectionNode };