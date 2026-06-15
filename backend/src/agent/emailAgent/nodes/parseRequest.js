import { ChatOpenAI } from "@langchain/openai";

const llm = new ChatOpenAI({
    model: process.env.OPENAI_LIGHT_MODEL,
    temperature: 0.4,
})

const parseRequestSchema = z.object({
    recipient_name: z.string().nullable(),
    tone: z.string().nullable(),
    purpose: z.string().nullable(),
});

const structuredModel = llm.withStructuredOutput(parseRequestSchema);

const parseRequest = async ({ state, config }) => {

    const systemPrompt = `Extract these fields from the user's request:
- recipient_name
- tone
- purpose

Return ONLY a valid JSON object with exactly these keys:
{
  "recipient_name": string | null,
  "tone": string | null,
  "purpose": string | null
}

Rules:
- If a field cannot be determined, set it to null.
- Do not add extra keys.
- Do not explain your answer.
- Do not wrap the JSON in markdown.`;

    const response = await structuredModel.invoke([
        {
            role: "system",
            content: systemPrompt
        },
        {
            role: "user",
            content: state.user_prompt
        }
    ])
    return {
        recipient_name: response.recipient_name,
        tone: response.tone
    };

}

export { parseRequest };