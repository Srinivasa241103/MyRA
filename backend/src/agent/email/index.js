import { emailAgent } from "./graph.js";
import { Command } from "@langchain/langgraph";

const runEmailAgent = async ({
    userMessage,
    conversationId,
    intent,
    userId = null,
    resumeValue,
}) => {
    const config = {
        configurable: {
            thread_id: conversationId,
            user_id: userId
        }
    };

    let input;

    if (resumeValue) {
        input = new Command({ resume: resumeValue })
    } else {
        input = { messages: [userMessage(userInput)], ...anyInitialState }
    }

    const result = await emailAgent.invoke(input, config)

    if (result.__interrupt__) {
        return {
            status: "paused",
            interruptType: result.__interrupt__[0].value.type,
            payload: result.__interrupt__[0].value,
            conversationId
        }
    } else {
        return {
            status: "complete",
            draft: result.currentDraft,
            sent: result.approvalStatus === "approved",
            finalMessage: result.messages.at(-1)?.content || '',
            conversationId
        }
    }
}

export { runEmailAgent }