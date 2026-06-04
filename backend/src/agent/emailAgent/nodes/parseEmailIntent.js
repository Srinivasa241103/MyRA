import { ChatAnthropic } from "@langchain/anthropic";
import buildParseIntentPrompt from "../prompts/parseIntent.prompt.js";
import { logger } from "../../../utils/logger.js";
import {
  safeParse,
  applySafetyDefaults,
} from "../schemas/parseOutput.schema.js";
import { mergeEmailDetails, appendError } from "../state.js";

const llm = new ChatAnthropic({
  model: process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001",
  temperature: 0,
});

const parseEmailIntent = async (state) => {
  const { userMessage, status } = state;
  const isReviewingMode = status === "reviewing";

  try {
    const { system, user } = buildParseIntentPrompt(userMessage, state);

    const response = await llm.invoke([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    const rawText = response.content;

    let parsed;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (error) {
      throw new Error(
        `Failed to parse LLM output as JSON. Raw output: ${rawText}`,
      );
    }

    if (isReviewingMode) {
      return {
        userFeedback: userMessage,
        feedbackClassification: parsed.feedbackClassification || "cancel",
        editInstruction: parsed.editInstruction || null,
        agentResponse: null,
        // status stays 'reviewing' — routeAfterParse reads feedbackClassification
      };
    }

    const { success, data, error } = safeParse(parsed);
    if (!success) {
      throw new Error(`Schema validation failed: ${error}`);
    }

    const safe = applySafetyDefaults(data);

    const updatedEmailDetails = mergeEmailDetails(state.emailDetails, {
      to: safe.to,
      cc: safe.cc,
      bcc: safe.bcc,
      subject: safe.subject,
      bodyIntent: safe.bodyIntent,
      tone: safe.tone,
      isReply: safe.isReply,
      replyReference: safe.replyReference,
    });

    return {
      status: "parsing",
      emailDetails: updatedEmailDetails,
      _userRequestedSend: safe._userRequestedSend,
      userFeedback: null,
      feedbackClassification: null,
      editInstruction: null,
      agentResponse: null,
    };
  } catch (error) {
    logger.error("Error in parseEmailIntent", error, { userMessage, status });
    const updatedErrors = appendError(state.errors, {
      node: "parseEmailIntent",
      message: error.message,
      retryable: false,
    });

    return {
      status: "error",
      errors: updatedErrors,
      agentResponse:
        "I had trouble understanding that. Could you rephrase what you want to do?",
    };
  }
};

export { parseEmailIntent };
