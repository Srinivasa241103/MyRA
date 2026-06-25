import { interrupt } from "@langchain/langgraph";

const parseReviewDecision = (response) => {
    if (response && typeof response === "object") {
        const action = response.action?.toLowerCase();
        if (action === "approve") return { action: "approve" };
        if (["cancel", "reject"].includes(action)) return { action: "cancel" };
        if (["edit", "revise", "regenerate"].includes(action)) {
            const feedback = response.feedback ?? response.value ?? "Regenerate the draft";
            return { action: "edit", feedback: String(feedback).trim() };
        }
    }

    if (typeof response !== "string") return null;

    const input = response.trim();
    const action = input.toLowerCase();

    if (["approve", "approved", "send", "looks good", "yes"].includes(action)) {
        return { action: "approve" };
    }

    if (["cancel", "reject", "stop"].includes(action)) {
        return { action: "cancel" };
    }

    const editMatch = input.match(/^(?:edit|revise|change|regenerate)\s*:?\s*(.*)$/i);
    if (editMatch) {
        return {
            action: "edit",
            feedback: editMatch[1].trim() || "Regenerate the draft",
        };
    }

    return null;
};

const reviewDraft = (state) => {
    let validationError = null;

    while (true) {
        const response = interrupt({
            type: "draft_approval",
            prompt: validationError,
            draft: {
                ...state.current_draft,
                source: "agent",
            },
            meta: {
                to: state.chosen_recipient.name
                    ? `${state.chosen_recipient.name} <${state.chosen_recipient.email}>`
                    : state.chosen_recipient.email,
                cc: null,
                tone: state.tone || "professional",
                version: state.current_draft.version,
                totalVersions: state.draft_history.length,
            },
            actions: ["approve", "edit", "cancel"],
            instructions: 'Reply "approve" to continue, "edit: <changes>" to revise, or "cancel".',
        });

        const decision = parseReviewDecision(response);

        if (decision?.action === "approve") {
            return {
                approval_status: "approved",
                approval_timestamp: new Date().toISOString(),
            };
        }

        if (decision?.action === "cancel") {
            return {
                cancelled: true,
                approval_status: "cancelled",
                send_status: "cancelled",
                final_response: "Email cancelled. Nothing was sent.",
            };
        }

        if (decision?.action === "edit") {
            return {
                previous_draft: state.current_draft,
                user_feedback: decision.feedback,
                edit_instructions: decision.feedback,
                approval_status: "revision_requested",
            };
        }

        validationError = "Please approve, request an edit, or cancel.";
    }
};

export { reviewDraft };
