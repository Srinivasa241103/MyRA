import {
    END,
    MemorySaver,
    START,
    StateGraph,
} from "@langchain/langgraph";
import { emailAgentState } from "./state.js";
import { draftEmail } from "./nodes/draftEmail.js";
import { parseRequest } from "./nodes/parseRequest.js";
import { prepareSend } from "./nodes/prepareSend.js";
import { presentRecipientChoice } from "./nodes/presentRecipientChoice.js";
import { resolveRecipient } from "./nodes/resolveRecipient.js";
import { reviewDraft } from "./nodes/reviewDraft.js";
import { revokeWindow } from "./nodes/revokeWindow.js";
import { sendEmailNode } from "./nodes/sendEmail.js";

const routeAfterRecipientChoice = (state) => {
    return state.cancelled ? END : "draft_email";
};

const routeAfterReview = (state) => {
    if (state.cancelled || state.approval_status === "cancelled") return END;
    if (state.approval_status === "revision_requested") return "draft_email";
    if (state.approval_status === "approved") return "prepare_send";
    return "review_draft";
};

const routeAfterRevokeWindow = (state) => {
    return state.send_status === "sending" ? "send_email" : END;
};

const checkpointer = new MemorySaver();

const builder = new StateGraph(emailAgentState)
    .addNode("parse_request", parseRequest)
    .addNode("resolve_recipient", resolveRecipient)
    .addNode("present_recipient_choice", presentRecipientChoice)
    .addNode("draft_email", draftEmail)
    .addNode("review_draft", reviewDraft)
    .addNode("prepare_send", prepareSend)
    .addNode("revoke_window", revokeWindow)
    .addNode("send_email", sendEmailNode)
    .addEdge(START, "parse_request")
    .addEdge("parse_request", "resolve_recipient")
    .addEdge("resolve_recipient", "present_recipient_choice")
    .addConditionalEdges("present_recipient_choice", routeAfterRecipientChoice, {
        draft_email: "draft_email",
        [END]: END,
    })
    .addEdge("draft_email", "review_draft")
    .addConditionalEdges("review_draft", routeAfterReview, {
        draft_email: "draft_email",
        prepare_send: "prepare_send",
        review_draft: "review_draft",
        [END]: END,
    })
    .addEdge("prepare_send", "revoke_window")
    .addConditionalEdges("revoke_window", routeAfterRevokeWindow, {
        send_email: "send_email",
        [END]: END,
    })
    .addEdge("send_email", END);

const emailAgent = builder.compile({ checkpointer });

export { emailAgent };
