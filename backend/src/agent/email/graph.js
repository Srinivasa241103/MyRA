import { START, END, StateGraph, MemorySaver } from "@langchain/langgraph";
import { emailAgentState } from "./state.js";
import { agentNode, sendNode, selectionNode, approvalNode, toolNode } from "./nodes/index.js";
import { routeAfterTool, routeAfterAgent, routeAfterApproval } from "./edges/index.js";

const checkpointer = new MemorySaver();

const builder = new StateGraph(emailAgentState)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addNode("selection", selectionNode)
    .addNode("approval", approvalNode)
    .addNode("send", sendNode)

    .addEdge(START, "agent")

    .addConditionalEdges("agent", routeAfterAgent, {
        tools: "tools",
        [END]: END,
    })

    .addConditionalEdges("tools", routeAfterTool, {
        selection: "selection",
        approval: "approval",
        agent: "agent",
    })

    .addEdge("selection", "agent")

    .addConditionalEdges("approval", routeAfterApproval, {
        send: "send",
        agent: "agent"
    })

    .addEdge("send", END);

export const emailAgent = builder.compile({ checkpointer });