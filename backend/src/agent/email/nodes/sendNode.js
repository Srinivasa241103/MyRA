import { END } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { sendEmail, saveDraft } from "../../../service/email/gmailSendService.js";

const sendNode = async (state) => {
    const { currentDraft, resolvedRecipient, mode, threadId } = state;

    const payload = {
        to: resolvedRecipient ? [resolvedRecipient.email] : [],
        subject: currentDraft.subject,
        body: currentDraft.body,
        threadId,                                               // null for non reply mails
    }

    const result = await (mode === "send" ? sendEmail(payload) : saveDraft(payload));

    const confirmation = result.success
        ? mode === "send"
            ? "Your email has been sent."
            : "Saved to you Gmail drafts."
        : `That didn't go through: ${result.error}`;

    return {
        messages: [new AIMessage(confirmation)]
    };
};

export { sendNode };
