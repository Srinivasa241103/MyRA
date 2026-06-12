import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, AIMessage } from "@langchain/core/messages";
import { tools } from "../tools.js";

const llm = new ChatOpenAI({
    model: process.env.OPENAI_PLANNER_MODEL,
});

const plannerLLM = llm.bindTools(tools);

const buildSystemPrompt = (state) => {
    const {
        intent,
        resolvedRecipient,
        threadId,
        currentDraft,
        pendingSelection,
        approvalStatus,
    } = state;

    const facts = [
        `Intent: ${intent ?? "unknown"}`,
        `Recipient resolved: ${resolvedRecipient ? resolvedRecipient.email : "not yet"}`,
        `Reply target identified: ${threadId ? "yes" : "not yet"}`,
        `Draft exists: ${currentDraft ? "yes" : "no"}`,
        `Awaiting user selection: ${pendingSelection ?? "none"}`,
        `Approval status: ${approvalStatus ?? "pending"}`,
    ].join("\n");

    return new SystemMessage(
        [
            "You are an email assistant operating as a ReAct agent. You accomplish the",
            "user's request by reasoning step by step and calling tools one at a time,",
            "observing each result before deciding the next action.",
            "",
            "TOOLS AVAILABLE:",
            "- fetchRecipientId: resolve a vague recipient name to candidate contacts.",
            "- retrieveReplyMail: semantic search for the mail/thread to reply to.",
            "- requestSelection: present candidates and pause for the user to pick one.",
            "- draftEmail: write or revise the email body (first draft and regen).",
            "- sendMail: send the email. RESTRICTED — only reachable after explicit",
            "  human approval. Never call this on your own initiative.",
            "",
            "HARD RULES:",
            "1. For a NEW mail, you must have a resolved recipient before drafting.",
            "2. For a REPLY, the reply target must be identified (IDs captured to state)",
            "   before drafting. Never invent or guess a thread/message id.",
            "3. If a lookup returns multiple candidates, call requestSelection — never",
            "   silently pick one yourself.",
            "4. Do not re-run a resolution step that is already satisfied (see STATE).",
            "5. Never call sendMail until approval status is 'approved'.",
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