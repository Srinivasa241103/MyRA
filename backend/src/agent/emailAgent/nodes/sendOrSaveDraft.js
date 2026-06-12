//import { gmailSendService } from "../../../service/email/gmailSendService.js";
import { appendError, getLatestDraft } from "../state.js";

/**
 * Terminal action node — the only place that calls the Gmail API.
 *
 * Decides send vs save-draft based on state._userRequestedSend.
 * _userRequestedSend is true only when the user explicitly said "send" during compose.
 *
 * On failure: surfaces error with retry options rather than silently ending.
 */
const sendOrSaveDraft = async (state) => {
  const { emailDetails, originalEmail, _userRequestedSend } = state;
  const latestDraft = getLatestDraft(state.draftHistory);

  if (!latestDraft) {
    return {
      status: "error",
      agentResponse:
        "No draft found to send. Something went wrong — please try again.",
    };
  }

  // Send only when user explicitly requested it during composition
  const shouldSend = _userRequestedSend === true;

  const emailPayload = {
    to: emailDetails.to.map((r) => r.email).filter(Boolean),
    cc: emailDetails.cc.map((r) => r.email).filter(Boolean),
    bcc: emailDetails.bcc.map((r) => r.email).filter(Boolean),
    subject: latestDraft.subject,
    body: latestDraft.body,
    threadId: originalEmail.threadId || null,
    inReplyTo: originalEmail.inReplyTo || null,
    references: originalEmail.references || null,
  };

  try {
    if (shouldSend) {
      const result = await gmailSendService.sendEmail(emailPayload);

      if (!result.success) {
        throw new Error(
          result.error || "Gmail send failed with no error message",
        );
      }

      return {
        status: "sent",
        sentMessageId: result.messageId,
        agentResponse: {
          type: "success",
          message: `Your email to ${emailPayload.to.join(", ")} has been sent.`,
          messageId: result.messageId,
        },
      };
    } else {
      const result = await gmailSendService.saveDraft(emailPayload);

      if (!result.success) {
        throw new Error(
          result.error || "Gmail draft save failed with no error message",
        );
      }

      return {
        status: "saved_draft",
        savedDraftId: result.draftId,
        agentResponse: {
          type: "success",
          message: `Draft saved to your Gmail drafts folder. Subject: "${latestDraft.subject}"`,
          draftId: result.draftId,
        },
      };
    }
  } catch (err) {
    console.error("[sendOrSaveDraft] Error:", err.message);

    const updatedErrors = appendError(state.errors, {
      node: "sendOrSaveDraft",
      message: err.message,
      retryable: true,
    });

    return {
      status: "error",
      errors: updatedErrors,
      agentResponse: {
        type: "error",
        message: "I couldn't complete that due to an error.",
        error: err.message,
        options: ["retry", "save_draft_instead", "cancel"],
      },
    };
  }
};

export { sendOrSaveDraft };
