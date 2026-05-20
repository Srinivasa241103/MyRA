import { ChatAnthropic } from "@langchain/anthropic";
import { buildApplyEditsPrompt } from "../prompts/applyEdits.prompt.js";
import { safeParseDraft } from "../schemas/draftOutput.schema.js";
import { appendDraft, appendError, getLatestDraft } from "../state.js";

const llm = new ChatAnthropic({
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
  temperature: 0.4,
});

/**
 * Applies the user's edit instruction to the current draft.
 * Appends the edited version to draftHistory as a new entry.
 * Always flows back to presentDraftForApproval after editing.
 */
const applyEdits = async (state) => {
  const currentDraft = getLatestDraft(state.draftHistory);
  const editInstruction = state.editInstruction || state.userFeedback;

  if (!currentDraft) {
    return {
      status: "error",
      agentResponse: "No draft found to edit. Let me generate one first.",
    };
  }

  if (!editInstruction) {
    return {
      status: "error",
      agentResponse:
        "I didn't catch what you'd like to change. Could you describe the edit?",
    };
  }

  try {
    const { system, user } = buildApplyEditsPrompt(
      currentDraft,
      editInstruction,
      state.emailDetails,
    );

    const response = await llm.invoke([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);

    const rawText = response.content;

    let parsed;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(
        `Claude returned non-JSON output: ${rawText.slice(0, 200)}`,
      );
    }

    const { success, data, error } = safeParseDraft(parsed);
    if (!success) {
      throw new Error(`Edit output schema validation failed: ${error}`);
    }

    const updatedHistory = appendDraft(state.draftHistory, {
      subject: data.subject,
      body: data.body,
      source: "edited",
    });

    return {
      status: "reviewing",
      draftHistory: updatedHistory,
      feedbackClassification: null,
      editInstruction: null,
      agentResponse: null,
    };
  } catch (err) {
    console.error("[applyEdits] Error:", err.message);

    const updatedErrors = appendError(state.errors, {
      node: "applyEdits",
      message: err.message,
      retryable: true,
    });

    return {
      status: "error",
      errors: updatedErrors,
      agentResponse:
        "I had trouble applying that edit. Could you describe what you want changed?",
    };
  }
};

export { applyEdits };
