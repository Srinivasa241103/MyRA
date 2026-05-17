import embeddingService from "../langchain/embeddings.js";
import { DocumentRepository } from "../../database/documentRepository.js";
import { logger } from "../../utils/logger.js";

const BATCH_SIZE = 50;

export default class EmbeddingPipeline {
  constructor() {
    this.documentRepo = new DocumentRepository();
  }

  async processAllPendingEmbeddings(syncLogId) {
    const startTime = Date.now();
    let processed = 0;

    try {
      logger.info("Starting embedding pipeline", { syncLogId });

      while (true) {
        const pending = await this.documentRepo.findPendingEmbeddings(BATCH_SIZE);
        if (pending.length === 0) break;

        for (const doc of pending) {
          try {
            const embedding = await embeddingService.embedDocument(doc.content);
            await this.documentRepo.updateEmbedding(doc.document_id, embedding);
            processed++;
          } catch (error) {
            logger.error("Failed to embed document", {
              documentId: doc.document_id,
              error: error.message,
            });
          }
        }

        logger.info("Embedding batch complete", {
          processed,
          batch: pending.length,
        });
      }

      const duration = Date.now() - startTime;
      logger.info("Embedding pipeline complete", { processed, duration, syncLogId });
      return { processed, duration };
    } catch (error) {
      logger.error("Embedding pipeline error", { error: error.message, syncLogId });
      return { processed, duration: Date.now() - startTime };
    }
  }
}
