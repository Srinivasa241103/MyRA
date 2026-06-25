import { interrupt } from "@langchain/langgraph";

const sleep = (milliseconds) => new Promise(resolve => {
    setTimeout(resolve, milliseconds);
});

const getAction = (response) => {
    if (response && typeof response === "object") {
        return {
            action: response.action?.toLowerCase(),
            token: response.token ?? null,
        };
    }

    if (typeof response === "string") {
        return { action: response.trim().toLowerCase(), token: null };
    }

    return { action: null, token: null };
};

const revokeWindow = async (state) => {
    let validationError = null;

    while (true) {
        const response = interrupt({
            type: "pending_send",
            prompt: validationError
                ?? "Email approved. You have 6 seconds to revoke it.",
            actions: ["revoke"],
            token: state.pending_send_token,
            deadline: state.revoke_deadline,
            recipient: state.chosen_recipient,
            draft: state.current_draft,
        });

        const { action, token } = getAction(response);

        if (["revoke", "undo", "cancel", "stop"].includes(action)) {
            return {
                send_status: "revoked",
                cancelled: true,
                pending_send_token: null,
                final_response: "Email send revoked. Nothing was sent.",
            };
        }

        if (token && token !== state.pending_send_token) {
            return {
                send_status: "failed",
                last_error: "Pending send token did not match",
                final_response: "The email was not sent because the pending-send token was invalid.",
            };
        }

        if (["timeout", "expired"].includes(action)) {
            break;
        }

        validationError = "The email cannot be sent early. Use revoke before the countdown ends.";
    }

    const remaining = Date.parse(state.revoke_deadline) - Date.now();
    if (remaining > 0) await sleep(remaining);

    return {
        send_status: "sending",
    };
};

export { revokeWindow };
