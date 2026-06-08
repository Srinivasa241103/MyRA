import Retriever from "../retrieval/retriever.js";
import { buildContext } from "../retrieval/contextBuilder.js";
import MemoryService from "./memoryService.js";
import LLMService from "./llmService.js";
import { logger } from "../../utils/logger.js";
import { buildPrompt } from "./prompts.js";

export default class QueryPipeline {
    constructor() {
        this.retriever = new Retriever();
        this.memoryService = new MemoryService();
        this.llmService = new LLMService();
    }

    async run({
        query,
        conversationId,
        userId,
        llmProvider = 'openAI',
        options = {}
    }) {
        try {
            if (!query) throw new Error("Query is missing");
            if (!conversationId) throw new Error("conversation id is missing");
            if (!userId) throw new Error("user id is missing");

            logger.info("Starting RAG chain ...");

            const startTime = Date.now();

            const retrievalResult = await this.retriever.retrieve(query, userId, options);
            logger.info(`Retrieved ${retrievalResult.length} chunks`);

            const context = buildContext(retrievalResult);
            logger.info(`Built context for query: "${query.substring(0, 30)}..."`);

            const retrievalDuration = Date.now() - startTime;

            const messageHistory = await this.memoryService.loadHistory(conversationId, userId);

            const buildPromptParams = {
                history: messageHistory,
                context,
                question: query
            }
            const messages = buildPrompt(buildPromptParams);

            const llmResponse = await this.llmService.generateResponse(llmProvider, messages, userId, conversationId)
            const llmResponseTime = llmResponse.duration;

            await this.memoryService.saveConversation(userId, conversationId, query, llmResponse.answer,
                {
                    sourceCount: retrievalResult.length,
                    sourceType: [...new Set(retrievalResult.map(r => r.source_type))],
                    retrievalDuration,
                    llmDuration: llmResponseTime,
                    llmProvider,
                });

            const totalDuration = Date.now() - startTime;
            logger.info("Query pipeline completed", {
                conversationId, userId, totalDuration, retrievalDuration,
                llmDuration: llmResponse.duration, sourceCount: retrievalResult.length,
            });

            const response = {
                answer: llmResponse.answer,
                sources: retrievalResult,
                conversationId,
                model: llmResponse.model
            }

            return response;

        } catch (error) {
            logger.error("Error in query pipeline", {
                error: error.message
            })
            throw new Error(`query pipeline failed: ${error.message}`);
        }
    }
}