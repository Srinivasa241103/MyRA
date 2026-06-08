import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { logger } from "../../utils/logger.js";
import { StatsRepository } from "../../database/statsRepository.js";
import { usdToInr } from "../../utils/exchanceRates.js";
import { LLM_INVOCATION_TYPES } from "../../utils/constants.js";

export default class LLMService {
    constructor() {
        this.llmMap = {
            "OpenAI": new ChatOpenAI({
                model: process.env.OPENAI_CHAT_MODEL,
                temperature: parseFloat(process.env.OPENAI_MODEL_TEMP),
                maxTokens: Number(process.env.OPENAI_MAX_TOKENS),
                maxRetries: 2,
                timeout: 30000,
                streaming: false,
            }),
            "Anthropic": new ChatAnthropic({
                model: process.env.ANTHROPIC_CHAT_MODEL,
                temperature: parseFloat(process.env.ANTHROPIC_MODEL_TEMP),
                maxTokens: Number(process.env.ANTHROPIC_MAX_TOKENS),
                maxRetries: 2,
                timeout: 30000,
                streaming: false,
            })
        };

        this.statsRepo = new StatsRepository();
    }

    async generateResponse(llmProvider = "OpenAI", messages, userId, conversationId) {

        const responseBody = {
            answer: "",
            model: "",
        }
        try {
            const startTime = Date.now();

            if (!['OpenAI', 'Anthropic'].includes(llmProvider)) throw new Error("LLM provider not found");

            if (!messages || messages.length === 0) {
                logger.error("Messages array is empty", { error: "Messages array is empty" });
                throw new Error("Messages array is empty");
            }

            const llm = this.llmMap[llmProvider];
            const llmResponse = await llm.invoke(messages);

            if (!llmResponse) {
                throw new Error("LLM returned empty response");
            }

            responseBody.answer = llmResponse.content;
            responseBody.model = (llmProvider === "Anthropic"
                ? process.env.ANTHROPIC_CHAT_MODEL
                : process.env.OPENAI_CHAT_MODEL);

            const duration = Date.now() - startTime;
            responseBody.duration = duration;

            //usage stats
            const usageData = llmResponse.usage_metadata;
            const statsParams = {
                conversationId,
                provider: llmProvider,
                model: responseBody.model,
                inputTokens: 0,
                outputTokens: 0,
                inputCost: 0,
                outputCost: 0,
                invocationType: LLM_INVOCATION_TYPES.RAG_CHAT,
                userId
            }
            if (usageData) {
                statsParams.inputTokens = usageData.input_tokens || 0;
                statsParams.outputTokens = usageData.output_tokens || 0;

                const rate = await usdToInr();
                statsParams.inputCost = (usageData.input_tokens * 0.20 / 1000000) * rate;
                statsParams.outputCost = ((usageData.output_tokens * 1.25) / 1000000) * rate;
            }

            try {
                await this.statsRepo.insertLLMPrice(statsParams);
            } catch (error) {
                logger.error("Error saving LLM usage stats", {
                    error: error.message,
                })
            }


            logger.info("LLM response generated successfully", {
                llmProvider,
                duration,
                conversationId,
                userId
            })

            return responseBody;

        } catch (error) {
            logger.error(`Error generating LLM response : ${llmProvider}`, {
                error: error.message
            })
            throw new Error(`LLM response error : ${error.message}`);
        }
    }
}