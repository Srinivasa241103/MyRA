import Embedding from "../ingestion/embeddingsProvider.js";
import { logger } from "../../utils/logger.js";
import { getVectorStore } from "../vectorStores/vectorStoreFactory.js";

export default class Retriever {
    constructor() {
        this.vectorStore = getVectorStore();
        this.embed = new Embedding();
    }

    async retrieve(query, userId, options = {}) {
        if (typeof query !== "string") {
            throw new Error("query must be a string")
        }
        if (!query) return [];

        if (!userId) throw new Error("userId is required");

        try {
            const queryEmbedding = await this.embed.embedQuery(query);

            logger.info(`Retrieveing relavant Documents for user: ${userId} with query: ${query}`);
            const topKChunks = await this.vectorStore.search({
                queryEmbedding,
                userId,
                topK: options.topK,
                filters: {
                    sourceType: options.sourceType ?? null,
                    occurredAfter: options.occurredAfter ?? null,
                    occurredBefore: options.occurredBefore ?? null,
                    metadata: options.metadata,
                },
            });

            if (!topKChunks || topKChunks.length === 0) {
                logger.info("No relevant chunks found")
                return [];
            }

            const filteredChunks = topKChunks.filter(chunk => chunk.distance <= 0.6); //adjust threshold after proper testing

            if (!filteredChunks || filteredChunks.length === 0) {
                logger.info("No relevant chunks found after filtering")
                return [];
            }

            logger.info(`Successfully retrieved ${filteredChunks.length} chunks for query: "${query.substring(0, 50)}..."`);
            return filteredChunks;

        } catch (error) {
            logger.error("Error retrieving chunks", error);
            throw error;
        }
    }
}
