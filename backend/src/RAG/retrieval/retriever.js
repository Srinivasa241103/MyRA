import Embedding from "../ingestion/embeddingsProvider.js";
import { logger } from "../../utils/logger.js";
import { getVectorStore } from "../vectorStores/vectorStoreFactory.js";
import { buildResolvedRetrievalPlan } from "./retrievalPlanner.js";

function toFiniteNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function mergeMetadata(planMetadata, optionMetadata) {
    return {
        ...(planMetadata || {}),
        ...(optionMetadata || {}),
    };
}

function hasMetadata(metadata) {
    return Object.keys(metadata).length > 0;
}

function buildSearchFilters(planFilters, options) {
    const metadata = mergeMetadata(planFilters.metadata, options.metadata);

    return {
        sourceType: options.sourceType ?? planFilters.sourceType ?? null,
        occurredAfter: options.occurredAfter ?? planFilters.occurredAfter ?? null,
        occurredBefore: options.occurredBefore ?? planFilters.occurredBefore ?? null,
        metadata: hasMetadata(metadata) ? metadata : undefined,
    };
}

function getChunkTimestamp(chunk) {
    if (chunk.occurred_at) {
        const timestamp = new Date(chunk.occurred_at).getTime();
        if (Number.isFinite(timestamp)) return timestamp;
    }

    const metadataTimestamp = Number(chunk.document?.metadata?.occurred_at_ms);
    return Number.isFinite(metadataTimestamp) ? metadataTimestamp : 0;
}

function sortChunks(chunks, sort) {
    if (sort === "latest") {
        return [...chunks].sort((a, b) => getChunkTimestamp(b) - getChunkTimestamp(a));
    }

    if (sort === "oldest") {
        return [...chunks].sort((a, b) => getChunkTimestamp(a) - getChunkTimestamp(b));
    }

    return chunks;
}

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
            const resolvedPlan = await buildResolvedRetrievalPlan({
                query,
                userId,
                now: options.now,
                timezone: options.timezone,
                options: {
                    vectorTopK: options.topK ?? options.vectorTopK,
                    finalTopK: options.finalTopK ?? options.topK,
                },
            });

            const vectorSearch = resolvedPlan.vectorSearch;
            const queryEmbedding = await this.embed.embedQuery(vectorSearch.query);
            const filters = buildSearchFilters(vectorSearch.filters, options);

            logger.info(`Retrieving relevant documents for user: ${userId} with query: ${query}`, {
                strategy: resolvedPlan.plan.strategy,
                sort: resolvedPlan.plan.sort,
                source: resolvedPlan.plan.filters.source,
                requiresMetadataResolution: resolvedPlan.plan.requiresMetadataResolution,
                warnings: resolvedPlan.warnings,
            });
            const topKChunks = await this.vectorStore.search({
                queryEmbedding,
                userId,
                topK: vectorSearch.topK,
                filters,
            });

            if (!topKChunks || topKChunks.length === 0) {
                logger.info("No relevant chunks found")
                return [];
            }

            const maxDistance = toFiniteNumber(options.maxDistance);
            const filteredChunks = maxDistance === null
                ? topKChunks
                : topKChunks.filter(chunk => chunk.distance <= maxDistance);

            if (!filteredChunks || filteredChunks.length === 0) {
                logger.info("No relevant chunks found after filtering")
                return [];
            }

            const sortedChunks = sortChunks(filteredChunks, vectorSearch.sort);
            const finalChunks = sortedChunks.slice(0, resolvedPlan.plan.limits.finalTopK);

            logger.info(`Successfully retrieved ${finalChunks.length} chunks for query: "${query.substring(0, 50)}..."`);
            return finalChunks;

        } catch (error) {
            logger.error("Error retrieving chunks", error);
            throw error;
        }
    }
}
