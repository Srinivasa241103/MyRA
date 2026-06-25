import { randomUUID } from "node:crypto";

const REVOKE_WINDOW_MS = 6000;

const prepareSend = (state) => {
    if (state.approval_status !== "approved") {
        throw new Error("Cannot prepare an email that has not been approved");
    }

    if (!state.chosen_recipient || !state.current_draft) {
        throw new Error("Cannot prepare an incomplete email");
    }

    const revokeDeadline = new Date(Date.now() + REVOKE_WINDOW_MS).toISOString();

    return {
        send_status: "pending_revoke",
        pending_send_token: randomUUID(),
        revoke_deadline: revokeDeadline,
        final_response: `Email approved. It will be sent in ${REVOKE_WINDOW_MS / 1000} seconds unless revoked.`,
    };
};

export { prepareSend, REVOKE_WINDOW_MS };
