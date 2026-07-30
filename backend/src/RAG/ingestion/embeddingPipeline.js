import { documentRepository } from "../../database/index.js";
import { chunkDocument } from "./chunker.js";
import Embedding from "./embeddingsProvider.js";
import { logger } from "../../utils/logger.js";
import { getVectorStore } from "../vectorStores/vectorStoreFactory.js";

export default class EmbeddingPipeline {
    constructor() {
        this.documentRepo = documentRepository;
        this.vectorStore = getVectorStore();
        this.embedder = new Embedding();
    }

    async runEmbedding(userId, options = {}) {
        if (!userId) {
            throw new Error('User ID is required for embedding generation');
        }

        const { batchSize = 50, maxBatches = 3 } = options;
        const response = {
            processed: 0,
            success: 0,
            failed: 0,
        }

        logger.info("Starting embedding generation for synced documents");
        let batchCount = 0;
        while (batchCount < maxBatches) {
            const pending = await this.documentRepo.findPendingEmbeddings(userId, batchSize);
            if (!pending.length) break;
            batchCount++;
            logger.info(`Embedding batch ${batchCount}`);
            logger.info(`Processing ${pending.length} documents...`);

            for (const doc of pending) {
                try {
                    //chunk each doc
                    const chunks = await chunkDocument(doc);
                    if (chunks.length === 0) {
                        await this.documentRepo.updateEmbedding(doc.document_id, userId);
                        response.success++;
                        continue;
                    }

                    //embed the chunks
                    const embedChunks = await this.embedder.embedChunks(chunks, {
                        userId,
                        conversationId: options.conversationId ?? `document_embedding:${doc.document_id}`,
                    });

                    //store each chunk and its embeddings
                    await this.vectorStore.upsertDocumentChunks({
                        document: doc,
                        chunks: embedChunks,
                    });
                    await this.documentRepo.updateEmbedding(doc.document_id, userId);
                    response.success++;

                } catch (error) {
                    response.failed++;
                    logger.error("Failed to embed document", {
                        documentId: doc.document_id,
                        error: error.message,
                    });
                }
                response.processed++;
                if (maxBatches !== Infinity && response.processed >= maxBatches * batchSize) {
                    break;
                }
            }
            if (maxBatches !== Infinity && response.processed >= maxBatches * batchSize) {
                break;
            }
        }
        return response;
    }
}
