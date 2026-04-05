import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

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
  const llm = new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_CHAT_MODEL || "gemini-2.0-flash",
    temperature: 0,
    apiKey: process.env.GEMINI_API_KEY,
  });

  const response = await llm.invoke([
    { role: "system", content: ROUTER_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ]);

  const intent = response.content.trim().toLowerCase();

  // Validate — never crash on unexpected output
  const validIntents = ["rag", "calendar_agent", "calendar_rag"];
  return validIntents.includes(intent) ? intent : "rag"; // Safe default
}
