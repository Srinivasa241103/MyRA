import { OpenAIEmbeddings } from "@langchain/openai";
import { countTotalTokens, estimateTokens } from "../../utils/tokenCounter.js";
import { LLM_INVOCATION_TYPES } from "../../utils/constants.js";
import { logLLMUsage } from "../query/llmService.js";

export default class Embedding {
    constructor() {
        this.provider = "OpenAI";
        this.model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
        this.embeddings = new OpenAIEmbeddings({
            model: this.model,
            apiKey: process.env.OPENAI_API_KEY,
            dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || "1536"),
        });
    }
    async embedChunks(chunks, options = {}) {
        if (!chunks?.length) return [];
        //embed each chunk and store them in the same chunk
        const contents = chunks.map((chunk) => (chunk.content));
        const vectors = await this.embeddings.embedDocuments(contents);
        await logLLMUsage({
            conversationId: options.conversationId ?? "document_embedding",
            provider: this.provider,
            model: this.model,
            invocationType: LLM_INVOCATION_TYPES.EMBEDDING,
            userId: options.userId ?? null,
            estimatedInputTokens: countTotalTokens(contents),
            estimatedOutputTokens: 0,
        });

        return chunks.map((chunk, i) => ({
            ...chunk,
            embedding: vectors[i],
        }));
    }

    async embedQuery(query, options = {}) {
        if (!query || typeof query !== "string") {
            throw new Error("embedQuery requires a non-empty string");
        }

        const vector = await this.embeddings.embedQuery(query);
        await logLLMUsage({
            conversationId: options.conversationId ?? "query_embedding",
            provider: this.provider,
            model: this.model,
            invocationType: LLM_INVOCATION_TYPES.EMBEDDING,
            userId: options.userId ?? null,
            estimatedInputTokens: estimateTokens(query),
            estimatedOutputTokens: 0,
        });
        return vector;
    }
}
