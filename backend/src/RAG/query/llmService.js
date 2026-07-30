import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { logger } from "../../utils/logger.js";
import { StatsRepository } from "../../database/statsRepository.js";
import { usdToInr } from "../../utils/exchanceRates.js";
import { LLM_INVOCATION_TYPES } from "../../utils/constants.js";

const statsRepo = new StatsRepository();
const missingPricingWarnings = new Set();

let exchangeRateCache = {
    value: null,
    expiresAt: 0,
};

const MODEL_PRICING_USD_PER_MILLION = {
    OpenAI: {
        "gpt-4.1-nano": { input: 0.1, output: 0.4 },
        "gpt-4.1-mini": { input: 0.4, output: 1.6 },
        "text-embedding-3-small": { input: 0.02, output: 0 },
        "text-embedding-3-large": { input: 0.13, output: 0 },
    },
    Anthropic: {
        "claude-haiku-4-5": { input: 1, output: 5 },
        "claude-haiku-4-5-20251001": { input: 1, output: 5 },
    },
};

const toOptionalNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const toEnvSlug = (value) =>
    String(value || "")
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();

const envCost = (provider, model, side) => {
    const modelSpecificKey = `${toEnvSlug(provider)}_${toEnvSlug(model)}_${side}_COST_PER_MILLION`;
    const providerKey = `${toEnvSlug(provider)}_${side}_COST_PER_MILLION`;
    return toOptionalNumber(process.env[modelSpecificKey] ?? process.env[providerKey]);
};

export function normalizeLLMProvider(provider = null, model = null) {
    const rawProvider = provider === undefined || provider === null || provider === ""
        ? null
        : String(provider).trim();

    if (!rawProvider && typeof model === "string" && model.trim().toLowerCase().startsWith("claude")) {
        return "Anthropic";
    }

    const normalized = (rawProvider || "OpenAI").toLowerCase();

    if (["openai", "open_ai", "open-ai"].includes(normalized)) {
        return "OpenAI";
    }

    if (["anthropic", "claude"].includes(normalized)) {
        return "Anthropic";
    }

    throw new Error(`Unsupported LLM provider: ${provider}`);
}

export function resolveLLMModel(provider = "OpenAI", model = null) {
    const canonicalProvider = normalizeLLMProvider(provider, model);
    const requestedModel = typeof model === "string" ? model.trim() : "";

    if (requestedModel) {
        if (canonicalProvider === "OpenAI" && requestedModel.toLowerCase().startsWith("claude")) {
            throw new Error(`Model ${requestedModel} belongs to Anthropic, not OpenAI`);
        }
        if (canonicalProvider === "Anthropic" && requestedModel.toLowerCase().startsWith("gpt")) {
            throw new Error(`Model ${requestedModel} belongs to OpenAI, not Anthropic`);
        }
        return requestedModel;
    }

    return canonicalProvider === "Anthropic"
        ? process.env.ANTHROPIC_CHAT_MODEL
        : process.env.OPENAI_CHAT_MODEL;
}

export function resolveLLMSelection(provider = null, model = null) {
    const canonicalProvider = normalizeLLMProvider(provider, model);
    return {
        provider: canonicalProvider,
        model: resolveLLMModel(canonicalProvider, model),
    };
}

function createChatModel({
    provider,
    model,
    temperature,
    maxTokens,
    streaming = false,
}) {
    const selection = resolveLLMSelection(provider, model);
    const isAnthropic = selection.provider === "Anthropic";
    const resolvedTemperature = temperature ?? toOptionalNumber(
        isAnthropic ? process.env.ANTHROPIC_MODEL_TEMP : process.env.OPENAI_MODEL_TEMP
    );
    const resolvedMaxTokens = maxTokens ?? toOptionalNumber(
        isAnthropic ? process.env.ANTHROPIC_MAX_TOKENS : process.env.OPENAI_MAX_TOKENS
    );

    const baseConfig = {
        model: selection.model,
        maxRetries: 2,
        timeout: 30000,
        streaming,
        ...(resolvedTemperature !== undefined ? { temperature: resolvedTemperature } : {}),
        ...(resolvedMaxTokens !== undefined ? { maxTokens: resolvedMaxTokens } : {}),
    };

    if (isAnthropic) {
        return new ChatAnthropic({
            ...baseConfig,
            apiKey: process.env.ANTHROPIC_API_KEY,
        });
    }

    return new ChatOpenAI({
        ...baseConfig,
        apiKey: process.env.OPENAI_API_KEY,
    });
}

function getModelPricing(provider, model) {
    const inputOverride = envCost(provider, model, "INPUT");
    const outputOverride = envCost(provider, model, "OUTPUT");

    if (inputOverride !== undefined || outputOverride !== undefined) {
        return {
            input: inputOverride ?? 0,
            output: outputOverride ?? 0,
        };
    }

    const directPricing = MODEL_PRICING_USD_PER_MILLION[provider]?.[model];
    if (directPricing) return directPricing;

    const normalizedModel = String(model || "").toLowerCase();
    if (provider === "OpenAI") {
        if (normalizedModel.includes("embedding")) return { input: 0.02, output: 0 };
        if (normalizedModel.includes("nano")) return { input: 0.1, output: 0.4 };
        if (normalizedModel.includes("mini")) return { input: 0.4, output: 1.6 };
    }

    if (provider === "Anthropic" && normalizedModel.includes("haiku")) {
        return { input: 1, output: 5 };
    }

    return null;
}

async function getUsdToInrRate() {
    if (exchangeRateCache.value && Date.now() < exchangeRateCache.expiresAt) {
        return exchangeRateCache.value;
    }

    try {
        const rate = await usdToInr();
        exchangeRateCache = {
            value: rate,
            expiresAt: Date.now() + 60 * 60 * 1000,
        };
        return rate;
    } catch (error) {
        logger.warn("Could not fetch USD to INR rate for usage logging", {
            error: error.message,
        });
        return null;
    }
}

function normalizeUsageData(usageData = {}) {
    const usage =
        usageData?.usage_metadata ||
        usageData?.response_metadata?.usage ||
        usageData?.additional_kwargs?.__raw_response?.usage ||
        usageData?.usage ||
        usageData ||
        {};

    const inputTokens =
        usage.input_tokens ??
        usage.prompt_tokens ??
        usage.promptTokens ??
        0;
    const outputTokens =
        usage.output_tokens ??
        usage.completion_tokens ??
        usage.completionTokens ??
        0;
    const totalTokens =
        usage.total_tokens ??
        usage.totalTokens ??
        inputTokens + outputTokens;

    return {
        inputTokens: Number(inputTokens) || 0,
        outputTokens: Number(outputTokens) || 0,
        totalTokens: Number(totalTokens) || 0,
    };
}

function contentToText(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === "string") return part;
                if (typeof part?.text === "string") return part.text;
                return "";
            })
            .filter(Boolean)
            .join("\n");
    }
    return content === undefined || content === null ? "" : String(content);
}

export async function logLLMUsage({
    conversationId,
    provider,
    model,
    usageData = null,
    invocationType = LLM_INVOCATION_TYPES.RAG_CHAT,
    userId = null,
    estimatedInputTokens = 0,
    estimatedOutputTokens = 0,
}) {
    try {
        const selection = resolveLLMSelection(provider, model);
        const normalizedUsage = normalizeUsageData(usageData);
        const inputTokens = normalizedUsage.inputTokens || estimatedInputTokens || 0;
        const outputTokens = normalizedUsage.outputTokens || estimatedOutputTokens || 0;
        const pricing = getModelPricing(selection.provider, selection.model);
        let inputCost = 0;
        let outputCost = 0;

        if (pricing && (inputTokens > 0 || outputTokens > 0)) {
            const rate = await getUsdToInrRate();
            if (rate) {
                inputCost = (inputTokens * pricing.input / 1_000_000) * rate;
                outputCost = (outputTokens * pricing.output / 1_000_000) * rate;
            }
        } else if (!pricing) {
            const warningKey = `${selection.provider}:${selection.model}`;
            if (!missingPricingWarnings.has(warningKey)) {
                missingPricingWarnings.add(warningKey);
                logger.warn("No model pricing configured; logging tokens with zero cost", {
                    provider: selection.provider,
                    model: selection.model,
                });
            }
        }

        await statsRepo.insertLLMPrice({
            conversationId,
            provider: selection.provider,
            model: selection.model,
            inputTokens,
            outputTokens,
            inputCost,
            outputCost,
            invocationType,
            userId,
        });
    } catch (error) {
        logger.error("Error saving LLM usage stats", {
            error: error.message,
            provider,
            model,
            invocationType,
            conversationId,
            userId,
        });
    }
}

export default class LLMService {
    async generateResponse(
        llmProvider = "OpenAI",
        messages,
        userId,
        conversationId,
        options = {}
    ) {
        const normalizedOptions = typeof options === "string" ? { model: options } : options;
        const selection = resolveLLMSelection(llmProvider, normalizedOptions.model);

        const responseBody = {
            answer: "",
            model: selection.model,
            provider: selection.provider,
        };

        try {
            const startTime = Date.now();

            if (!messages || messages.length === 0) {
                logger.error("Messages array is empty", { error: "Messages array is empty" });
                throw new Error("Messages array is empty");
            }

            const llm = createChatModel({
                provider: selection.provider,
                model: selection.model,
                temperature: normalizedOptions.temperature,
                maxTokens: normalizedOptions.maxTokens,
                streaming: normalizedOptions.streaming ?? false,
            });
            const llmResponse = await llm.invoke(messages);

            if (!llmResponse) {
                throw new Error("LLM returned empty response");
            }

            responseBody.answer = contentToText(llmResponse.content);
            responseBody.duration = Date.now() - startTime;

            await logLLMUsage({
                conversationId,
                provider: selection.provider,
                model: selection.model,
                usageData: llmResponse,
                invocationType: normalizedOptions.invocationType ?? LLM_INVOCATION_TYPES.RAG_CHAT,
                userId,
            });

            logger.info("LLM response generated successfully", {
                llmProvider: selection.provider,
                model: selection.model,
                duration: responseBody.duration,
                conversationId,
                userId,
                invocationType: normalizedOptions.invocationType ?? LLM_INVOCATION_TYPES.RAG_CHAT,
            });

            return responseBody;
        } catch (error) {
            logger.error(`Error generating LLM response : ${selection.provider}`, {
                error: error.message,
                model: selection.model,
            });
            throw new Error(`LLM response error : ${error.message}`);
        }
    }

    async generateStructuredResponse({
        llmProvider = "OpenAI",
        model = null,
        schema,
        messages,
        userId,
        conversationId,
        invocationType = LLM_INVOCATION_TYPES.RAG_CHAT,
        temperature,
        maxTokens,
        structuredConfig = {},
    }) {
        const selection = resolveLLMSelection(llmProvider, model);

        if (!schema) {
            throw new Error("Structured response schema is required");
        }
        if (!messages || messages.length === 0) {
            throw new Error("Messages array is empty");
        }

        const llm = createChatModel({
            provider: selection.provider,
            model: selection.model,
            temperature,
            maxTokens,
        });
        const structuredModel = llm.withStructuredOutput(schema, {
            ...structuredConfig,
            includeRaw: true,
        });
        const result = await structuredModel.invoke(messages);

        await logLLMUsage({
            conversationId,
            provider: selection.provider,
            model: selection.model,
            usageData: result.raw,
            invocationType,
            userId,
        });

        return result.parsed;
    }
}
