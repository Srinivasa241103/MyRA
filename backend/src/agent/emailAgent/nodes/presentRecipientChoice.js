import { interrupt } from "@langchain/langgraph";
import { isValidEmail } from "../tools.js";

const findCandidate = (value, candidates) => {
    if (typeof value === "number") return candidates[value - 1] ?? null;
    if (typeof value !== "string") return null;

    const input = value.trim();
    if (/^\d+$/.test(input)) return candidates[Number(input) - 1] ?? null;

    return candidates.find(candidate =>
        candidate.email.toLowerCase() === input.toLowerCase()
        || candidate.name.toLowerCase() === input.toLowerCase()
    ) ?? null;
};

const parseChoice = (response, candidates) => {
    if (response && typeof response === "object") {
        const action = response.action?.toLowerCase();
        if (action === "cancel") return { cancelled: true };

        if (response.email && isValidEmail(response.email)) {
            return {
                recipient: {
                    name: response.name?.trim() || "",
                    email: response.email.trim(),
                },
            };
        }

        return parseChoice(response.value ?? response.selection, candidates);
    }

    if (typeof response === "string") {
        const input = response.trim();
        const action = input.toLowerCase();

        if (["cancel", "stop", "reject"].includes(action)) {
            return { cancelled: true };
        }

        if (["approve", "confirm", "use this", "yes"].includes(action)) {
            return candidates.length === 1
                ? { recipient: candidates[0] }
                : null;
        }

        const candidate = findCandidate(input, candidates);
        if (candidate) return { recipient: candidate };

        if (isValidEmail(input)) {
            return { recipient: { name: "", email: input } };
        }
    }

    if (typeof response === "number") {
        const candidate = findCandidate(response, candidates);
        return candidate ? { recipient: candidate } : null;
    }

    return null;
};

const buildPrompt = (state, candidates, error = null) => {
    const prefix = error ? `${error}\n\n` : "";

    if (candidates.length === 0) {
        return `${prefix}No matching recipient was found. Enter the recipient's full email address, or type "cancel".`;
    }

    if (candidates.length === 1) {
        const recipient = candidates[0];
        return `${prefix}I found ${recipient.name || "this recipient"} <${recipient.email}>. Reply "approve" to use it, enter another email address, or type "cancel".`;
    }

    return `${prefix}Select a recipient by number, name, or email address. You can also enter a different full email address.`;
};

const presentRecipientChoice = (state) => {
    const candidates = state.recipient_candidates;
    let validationError = state.recipient_lookup_error
        ? "Recipient lookup was unavailable, so please enter the email address manually."
        : null;

    while (true) {
        const response = interrupt({
            type: "recipient_choice",
            prompt: buildPrompt(state, candidates, validationError),
            placeholder: "name@example.com",
            candidates,
            actions: ["select", "enter_email", "cancel"],
        });

        const choice = parseChoice(response, candidates);

        if (choice?.cancelled) {
            return {
                cancelled: true,
                approval_status: "cancelled",
                send_status: "cancelled",
                final_response: "Email creation cancelled. Nothing was sent.",
            };
        }

        if (choice?.recipient) {
            return {
                chosen_recipient: choice.recipient,
                recipient_candidates: [],
                recipient_lookup_error: null,
            };
        }

        validationError = "Please choose a listed recipient or enter a valid email address.";
    }
};

export { presentRecipientChoice };
