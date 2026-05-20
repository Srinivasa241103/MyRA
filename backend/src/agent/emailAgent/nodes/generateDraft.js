import { ChatAnthropic } from "@langchain/anthropic";
import { buildGenerateDraftPrompt } from "../prompts/generateDraft.prompt.js";
import { safeParseDraft } from "../schemas/draftOutput.schema.js";
import { appendDraft, appendError } from "../state.js";

const llm = new ChatAnthropic({
  model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
  temperature: 0.6,
});

/**
 * Generates an email draft using Claude.
 * Appends the result to draftHistory — never overwrites.
 * Always flows to presentDraftForApproval next.
 */
const generateDraft = async (state) => {
  const isRegenerate = state.feedbackClassification === "regenerate";

  try {
    const { system, user } = buildGenerateDraftPrompt(state, isRegenerate);

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
      throw new Error(`Draft schema validation failed: ${error}`);
    }

    const updatedHistory = appendDraft(state.draftHistory, {
      subject: data.subject,
      body: data.body,
      source: isRegenerate ? "regenerated" : "generated",
    });

    return {
      status: "reviewing",
      draftHistory: updatedHistory,
      feedbackClassification: null,
      agentResponse: null,
    };
  } catch (err) {
    console.error("[generateDraft] Error:", err.message);

    const updatedErrors = appendError(state.errors, {
      node: "generateDraft",
      message: err.message,
      retryable: true,
    });

    return {
      status: "error",
      errors: updatedErrors,
      agentResponse:
        "I had trouble generating the draft. Would you like me to try again?",
    };
  }
};

export { generateDraft };
