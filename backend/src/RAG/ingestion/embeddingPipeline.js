import { documentRepository } from "../../database/index.js";
import { chunkRepository } from "../../database/index.js";
import { chunkDocument } from "./chunker.js";
import Embedding from "./embeddingsProvider.js";
import { logger } from "../../utils/logger.js";

export default class EmbeddingPipeline {
    constructor() {
        this.documentRepo = documentRepository;
        this.chunkRepo = chunkRepository;
        this.embedder = new Embedding();
    }

    async runEmbedding(options = {}) {
        const { batchSize = 50, maxBatches = 3 } = options;
        const response = {
            processed: 0,
            success: 0,
            failed: 0,
        }

        logger.info("Starting embedding generation for synced documents");
        let batchCount = 0;
        while (batchCount < maxBatches) {
            const pending = await this.documentRepo.findPendingEmbeddings(batchSize);
            if (!pending.length) break;
            batchCount++;
            logger.info(`Embedding batch ${batchCount}`);
            logger.info(`Processing ${pending.length} documents...`);

            for (const doc of pending) {
                try {
                    //chunk each doc
                    const chunks = await chunkDocument(doc);
                    if (chunks.length === 0) {
                        await this.documentRepo.updateEmbedding(doc.document_id);
                        response.success++;
                        continue;
                    }

                    //embed the chunks
                    const embedChunks = await this.embedder.embedChunks(chunks);

                    //store each chunk and its embeddings
                    await this.chunkRepo.insertChunks(doc.id, embedChunks);
                    await this.documentRepo.updateEmbedding(doc.document_id);
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
