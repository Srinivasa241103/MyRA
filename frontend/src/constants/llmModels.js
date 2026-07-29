export const DEFAULT_LLM_MODEL_ID = "anthropic-haiku";

export const LLM_MODEL_OPTIONS = [
  {
    id: "anthropic-haiku",
    provider: "Anthropic",
    modelName: "claude-haiku-4-5",
    label: "Anthropic",
    detail: "Claude Haiku 4.5",
  },
  {
    id: "openai-light",
    provider: "OpenAI",
    modelName: "gpt-4.1-nano",
    label: "OpenAI Light",
    detail: "gpt-4.1-nano",
  },
  {
    id: "openai-medium",
    provider: "OpenAI",
    modelName: "gpt-5.4-nano",
    label: "OpenAI Medium",
    detail: "gpt-5.4-nano",
  },
  {
    id: "openai-heavy",
    provider: "OpenAI",
    modelName: "gpt-5.4-mini",
    label: "OpenAI Heavy",
    detail: "gpt-5.4-mini",
  },
];

export function getLlmModelOption(modelId = DEFAULT_LLM_MODEL_ID) {
  return (
    LLM_MODEL_OPTIONS.find((option) => option.id === modelId) ||
    LLM_MODEL_OPTIONS[0]
  );
}
