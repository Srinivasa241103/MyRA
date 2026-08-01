import { chunkDocument } from "./chunker.js";
import Embedding from "./embeddingsProvider.js";
import { logger } from "../../utils/logger.js";
import {
  RetrievalIndexRepository,
  type IndexableDocument,
} from "../../database/retrievalIndexRepository.js";
import RetrievalIndexWriter, {
  RetrievalIndexWriteError,
  type RetrievalIndexWriteResult,
} from "./retrievalIndexWriter.js";
import type {
  EmbeddedChunk,
  OwnerId,
} from "../vectorStores/vectorStore.js";
import type { VectorStoreProvider } from "../vectorStores/vectorStoreFactory.js";

export interface EmbeddingPipelineOptions {
  batchSize?: number;
  maxBatches?: number;
  conversationId?: string;
  sourceType?: string | null;
}

export interface EmbeddingPipelineResult {
  processed: number;
  success: number;
  failed: number;
  pending: number;
  postgresIndexed: number;
  vectorIndexed: number;
  vectorProvider: VectorStoreProvider | null;
}

interface EmbeddingPipelineDependencies {
  indexRepository?: RetrievalIndexRepository;
  indexWriter?: RetrievalIndexWriter;
  embedder?: Embedding;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_BATCHES = 3;

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : fallback;
}

function normalizedMaxBatches(value: number | undefined): number {
  if (value === Number.POSITIVE_INFINITY) return value;
  return positiveInteger(value, DEFAULT_MAX_BATCHES);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default class EmbeddingPipeline {
  private readonly indexRepository: RetrievalIndexRepository;
  private readonly indexWriter: RetrievalIndexWriter;
  private readonly embedder: Embedding;

  constructor({
    indexRepository = new RetrievalIndexRepository(),
    indexWriter = new RetrievalIndexWriter(),
    embedder = new Embedding(),
  }: EmbeddingPipelineDependencies = {}) {
    this.indexRepository = indexRepository;
    this.indexWriter = indexWriter;
    this.embedder = embedder;
  }

  private async buildEmbeddedChunks(
    document: IndexableDocument,
    userId: OwnerId,
    conversationId?: string,
  ): Promise<EmbeddedChunk[]> {
    const chunks = await chunkDocument(document);
    if (chunks.length === 0) return [];

    return this.embedder.embedChunks(chunks, {
      userId,
      conversationId: conversationId ??
        `document_embedding:${document.document_id}`,
    }) as Promise<EmbeddedChunk[]>;
  }

  async runEmbedding(
    userId: OwnerId,
    options: EmbeddingPipelineOptions = {},
  ): Promise<EmbeddingPipelineResult> {
    if (!userId) {
      throw new Error("User ID is required for embedding generation");
    }

    const batchSize = positiveInteger(options.batchSize, DEFAULT_BATCH_SIZE);
    const maxBatches = normalizedMaxBatches(options.maxBatches);
    const attemptedDocumentIds = new Set<string>();
    const response: EmbeddingPipelineResult = {
      processed: 0,
      success: 0,
      failed: 0,
      pending: 0,
      postgresIndexed: 0,
      vectorIndexed: 0,
      vectorProvider: null,
    };

    logger.info("Starting retrieval index generation", {
      userId,
      batchSize,
      maxBatches: Number.isFinite(maxBatches) ? maxBatches : "all",
    });

    let batchCount = 0;
    while (batchCount < maxBatches) {
      const pending = await this.indexRepository.findPendingDocuments({
        userId,
        limit: batchSize,
        excludeDocumentIds: [...attemptedDocumentIds],
        sourceType: options.sourceType ?? null,
      });
      if (pending.length === 0) break;

      batchCount++;
      logger.info("Processing retrieval index batch", {
        userId,
        batch: batchCount,
        documentCount: pending.length,
      });

      for (const document of pending) {
        attemptedDocumentIds.add(String(document.id));
        response.processed++;

        try {
          const chunks = await this.buildEmbeddedChunks(
            document,
            userId,
            options.conversationId,
          );
          const writeResult: RetrievalIndexWriteResult =
            await this.indexWriter.upsertDocumentChunks({
              document,
              chunks,
            });

          // This is the commit marker for retrieval visibility. A failed index
          // write leaves needs_embedding=true so a later run can retry safely.
          await this.indexRepository.markDocumentIndexed(
            document.id,
            userId,
          );

          response.success++;
          response.postgresIndexed++;
          response.vectorIndexed++;
          response.vectorProvider = writeResult.provider;
        } catch (error) {
          response.failed++;
          logger.error("Failed to index document for retrieval", error, {
            userId,
            documentId: document.document_id,
            stage: error instanceof RetrievalIndexWriteError
              ? error.stage
              : "embedding_or_status_update",
          });
        }
      }
    }

    response.pending = await this.indexRepository.countPendingDocuments({
      userId,
      sourceType: options.sourceType ?? null,
    });

    logger.info("Retrieval index generation completed", {
      userId,
      ...response,
    });
    return response;
  }
}
