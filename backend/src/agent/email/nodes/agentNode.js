import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage } from "@langchain/core/messages";
import { tools } from "../tools.js";

const llm = new ChatOpenAI({
    model: process.env.OPENAI_PLANNER_MODEL,
    temperature: 0.4,
    maxTokens: 8000,
    maxOutputTokens: 8000
});

const plannerLLM = llm.bindTools(tools);

const buildSystemPrompt = (state) => {
    const {
        intent,
        mode,
        resolvedRecipient,
        threadId,
        currentDraft,
        pendingSelection,
        approvalStatus,
        bodyHints,
    } = state;

    const factLines = [
        `Intent: ${intent ?? "unknown"}`,
        `Mode: ${mode}`,
        `Recipient resolved: ${resolvedRecipient ? resolvedRecipient.email : "not yet"}`,
        `Reply target identified: ${threadId ? "yes" : "not yet"}`,
        `Draft exists: ${currentDraft ? "yes" : "no"}`,
        `Awaiting user selection: ${pendingSelection ?? "none"}`,
        `Approval status: ${approvalStatus ?? "pending"}`,
    ];

    // After a rejection, surface the latest feedback so the planner can re-draft
    // with it (the prior draft is already visible in the message history).
    if (approvalStatus === "rejected" && bodyHints?.length) {
        factLines.push(
            `Regenerate the draft addressing this feedback: "${bodyHints[bodyHints.length - 1]}"`
        );
    }

    const facts = factLines.join("\n");

    return new SystemMessage(
        [
            "You are an email assistant operating as a ReAct agent. You accomplish the",
            "user's request by reasoning step by step and calling tools one at a time,",
            "observing each result before deciding the next action.",
            "",
            "TOOLS AVAILABLE:",
            "- fetch_recipient_mailId_list: resolve a recipient name to a contact. If",
            "  several match (or none), the system pauses for the user to pick or supply",
            "  an address — you do NOT choose a candidate yourself.",
            "- retrieve_reply_mail_thread: find the thread to reply to (sets reply context).",
            "- draft_email: write or revise the email body (first draft and regen).",
            "",
            "Sending, saving, recipient selection, and draft approval are handled by the",
            "system AFTER your tool calls — you have no send tool and cannot send mail.",
            "Once a recipient is resolved and a draft is produced, your job is done; the",
            "system presents the draft for approval and sends/saves on the user's behalf.",
            "",
            "HARD RULES:",
            "1. For a NEW mail, you must have a resolved recipient before drafting.",
            "2. For a REPLY, the reply target must be identified (IDs captured to state)",
            "   before drafting. Never invent or guess a thread/message id.",
            "3. Do not re-run a resolution step that is already satisfied (see STATE).",
            "4. Call exactly one tool per step; once recipient + draft exist, stop.",
            "",
            "CURRENT STATE:",
            facts,
            "",
            "Decide the single next action. If the task is complete, respond with a",
            "final message and no tool call.",
        ].join("\n"))
}

const agentNode = async (state) => {
    //Build the message list for this turn
    const systemMessage = buildSystemPrompt(state);
    const messages = [
        systemMessage,
        ...state.messages,
    ];
    //Invoke the tool-boundLLM
    const response = await plannerLLM.invoke(messages);
    //return the state update
    return {
        messages: [response]
    };
};

export { agentNode };