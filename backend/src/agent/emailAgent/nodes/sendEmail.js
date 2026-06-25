import { sendApprovedEmail } from "../tools.js";

const sendEmailNode = async (state, config) => {
    const approved = state.approval_status === "approved";
    const revokeWindowExpired = Date.now() >= Date.parse(state.revoke_deadline);

    if (!approved || state.send_status !== "sending" || !revokeWindowExpired) {
        return {
            send_status: "failed",
            last_error: "Email send safety checks failed",
            final_response: "The email was not sent because its safety checks failed.",
        };
    }

    if (!state.pending_send_token || !state.chosen_recipient || !state.current_draft) {
        return {
            send_status: "failed",
            last_error: "Email send data was incomplete",
            final_response: "The email was not sent because required data was missing.",
        };
    }

    const result = await sendApprovedEmail({
        userId: config?.configurable?.user_id
            ?? parseInt(process.env.SYNC_USER_ID, 10),
        recipient: state.chosen_recipient,
        draft: state.current_draft,
        threadId: state.thread_id,
    });

    if (!result.success) {
        return {
            send_status: "failed",
            pending_send_token: null,
            last_error: result.error,
            final_response: `The email could not be sent: ${result.error}`,
        };
    }

    return {
        send_status: "sent",
        pending_send_token: null,
        message_id: result.messageId ?? null,
        thread_id: result.threadId ?? state.thread_id,
        last_error: null,
        final_response: `Email sent successfully to ${state.chosen_recipient.email}.`,
    };
};

export { sendEmailNode };
