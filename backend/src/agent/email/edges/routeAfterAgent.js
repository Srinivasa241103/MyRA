import { END } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";

const routeAfterAgent = (state) => {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage?.tool_calls?.length) {
        return "tools";
    }
    return END;
};
export { routeAfterAgent };