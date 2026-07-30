export const DEFAULT_LLM_MODEL_ID = "anthropic-haiku";

export const LLM_MODEL_OPTIONS = [
  {
    id: "anthropic-haiku",
    provider: "Anthropic",
    model: "claude-haiku-4-5",
    displayName: "Haiku 4.5",
  },
  {
    id: "openai-light",
    provider: "OpenAI",
    model: "gpt-4.1-nano",
    displayName: "GPT 4.1 nano",
  },
  {
    id: "openai-medium",
    provider: "OpenAI",
    model: "gpt-5.4-nano",
    displayName: "GPT 5.4 nano",
  },
  {
    id: "openai-heavy",
    provider: "OpenAI",
    model: "gpt-5.4-mini",
    displayName: "GPT 5.4 mini",
  },
];

export function getLlmModelOption(modelId = DEFAULT_LLM_MODEL_ID) {
  return (
    LLM_MODEL_OPTIONS.find((option) => option.id === modelId) ||
    LLM_MODEL_OPTIONS[0]
  );
}
