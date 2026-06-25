import { searchRecipients } from "../tools.js";

const resolveRecipient = async (state, config) => {
    if (state.recipient_email_from_request) {
        return {
            recipient_candidates: [{
                name: state.recipient_name || "",
                email: state.recipient_email_from_request,
            }],
            recipient_lookup_error: null,
        };
    }

    if (!state.recipient_name) {
        return {
            recipient_candidates: [],
            recipient_lookup_error: null,
        };
    }

    const userId = config?.configurable?.user_id
        ?? parseInt(process.env.SYNC_USER_ID, 10);

    try {
        const recipients = await searchRecipients({
            userId,
            recipientName: state.recipient_name,
        });

        return {
            recipient_candidates: recipients,
            recipient_lookup_error: null,
        };
    } catch (error) {
        return {
            recipient_candidates: [],
            recipient_lookup_error: error.message,
        };
    }
};

export { resolveRecipient };
