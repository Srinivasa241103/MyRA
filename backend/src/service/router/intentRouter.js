import { ChatAnthropic } from "@langchain/anthropic";

const ROUTER_SYSTEM_PROMPT = `
You are an intent classifier for a personal AI assistant.
Classify the user's message into exactly one of these categories:

- "rag": User is asking a question, requesting information,
  or wanting to retrieve/summarise personal data.
  Examples: "What emails did I get from Rahul?",
            "Summarise my week", "What music did I listen to?"

- "calendar_agent": User wants to CREATE, SCHEDULE, or MODIFY
  a calendar event. This requires taking action, not just reading.
  Examples: "Schedule a meeting tomorrow",
            "Block 2 hours for studying", "Create an event"

- "calendar_rag": User wants to READ or QUERY calendar data
  but NOT create anything.
  Examples: "What's on my calendar tomorrow?",
            "Am I free on Friday?", "Show me this week's meetings"

Respond with ONLY the category name, nothing else.
`;

export async function routeIntent(userMessage) {
  const llm = new ChatAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: "claude-haiku-4-5-20251001",
    maxTokens: 16,
    temperature: 0,
  });

  const response = await llm.invoke([
    {
      role: "user",
      content: `${ROUTER_SYSTEM_PROMPT}\n\nMessage: ${userMessage}`,
    },
  ]);

  const intent = response.content.trim().toLowerCase();

  // Validate — never crash on unexpected output
  const validIntents = ["rag", "calendar_agent", "calendar_rag"];
  return validIntents.includes(intent) ? intent : "rag"; // Safe default
}
