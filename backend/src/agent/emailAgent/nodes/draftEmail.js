import { createEmailDraft } from "../tools.js";

const draftEmail = async (state, config) => {
    if (!state.chosen_recipient) {
        throw new Error("Cannot draft email without a chosen recipient");
    }

    const draft = await createEmailDraft({
        userPrompt: state.original_user_request,
        purpose: state.purpose,
        tone: state.tone,
        recipient: state.chosen_recipient,
        previousDraft: state.previous_draft,
        feedback: state.user_feedback,
        llmProvider: state.llm_provider ?? config?.configurable?.llmProvider,
        model: state.llm_model ?? config?.configurable?.model,
        userId: config?.configurable?.user_id ?? parseInt(process.env.SYNC_USER_ID, 10),
        conversationId: config?.configurable?.thread_id ?? "email_agent_draft",
    });

    const currentDraft = {
        subject: draft.subject.trim(),
        body: draft.body.trim(),
        version: (state.current_draft?.version ?? 0) + 1,
    };

    return {
        current_draft: currentDraft,
        draft_history: currentDraft,
        approval_status: "awaiting_review",
        user_feedback: null,
        last_error: null,
    };
};

export { draftEmail };
