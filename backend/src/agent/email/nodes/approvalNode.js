// backend/src/agent/email/nodes/approvalNode.js
import { interrupt } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";

/**
 * approvalNode — human-in-the-loop gate before an email is sent or saved.
 *
 * Entered when a draft exists and approvalStatus is still "pending" (routeAfterTool).
 * Surfaces the draft via interrupt(), suspends the graph, and resumes with the
 * user's decision. Writes approvalStatus so routeAfterApproval can branch:
 *   - "approved" -> planner may now send_email / save_draft
 *   - "rejected" -> planner re-drafts using previousDraft + the new bodyHints
 *
 * Resume payload (sent back via Command({ resume })):
 *   { action: "approve" }
 *   { action: "edit" | "regenerate", feedback: "<what to change>" }
 *   (a bare action string is also accepted)
 */
const approvalNode = (state) => {
    const { currentDraft, resolvedRecipient, threadId } = state;

    // Suspend here. Execution resumes only when the client calls
    // graph.invoke(new Command({ resume: <decision> }), config).
    const decision = interrupt({
        type: "draft_approval",
        draft: currentDraft,
        meta: {
            to: resolvedRecipient
                ? `${resolvedRecipient.name} <${resolvedRecipient.email}>`
                : null,
            isReply: Boolean(threadId),
        },
        actions: ["approve", "edit", "regenerate", "cancel"],
        instructions:
            'Reply "approve" to send, "edit: <changes>" or "regenerate" to revise, or "cancel" to stop.',
    });

    // Normalize: accept either a structured decision or a bare action string.
    const action = (typeof decision === "string" ? decision : decision?.action ?? "")
        .trim()
        .toLowerCase();
    const feedback =
        typeof decision === "object" && decision ? decision.feedback ?? "" : "";

    if (action === "approve") {
        return { approvalStatus: "approved" };
    }

    if (action === "cancel") {
        return {
            aborted: true,
            messages: [new AIMessage("Okay - cancelled. Nothing was sent or saved. ")],
        };
    }
    return {
        approvalStatus: "rejected",
        previousDraft: currentDraft,
        ...(feedback ? { bodyHints: feedback } : {}),
    };
};

export { approvalNode };
