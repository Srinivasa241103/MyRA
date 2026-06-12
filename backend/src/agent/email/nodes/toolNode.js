import { tools } from "../tools.js";
import { ToolNode } from "@langchain/langgraph/prebuilt";

const toolNode = new ToolNode(tools);

export { toolNode };