import { ChatAnthropic } from "@langchain/anthropic";
import { buildClarifyPrompt } from "../prompts/clarify.prompt.js";
import { appendError } from "../state.js";
import { logger } from "../../../utils/logger.js";

const llm = new ChatAnthropic({
  temperature: 0.3,
  model: process.env.CLAUDE_MODEL,
});

const clarifyMissing = async (state) => {
  const { missingFields, emailDetails, intent, ambiguousFields } = state;

  // If resolveReplyContext already set an ambiguity message, surface it directly
  if (ambiguousFields && ambiguousFields.length > 0 && state.agentResponse) {
    return {
      status: "clarifying",
      agentResponse: state.agentResponse,
    };
  }

  try {
    const { system, user } = buildClarifyPrompt(
      missingFields,
      emailDetails,
      intent,
    );
    const response = await llm.invoke([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    const question = response.content.trim();
    return {
      status: "clarifying",
      agentResponse: question,
    };
  } catch (error) {
    logger.error("Error occurred while clarifying missing fields:", error);
    const updatedErrors = appendError(state.errors, {
      node: "clarifyMissing",
      message: error.message,
      retryable: false,
    });

    return {
      status: "clarifying",
      agentResponse:
        "Could you provide a bit more detail about the email you want to send?",
      errors: updatedErrors,
    };
  }
};

export { clarifyMissing };
