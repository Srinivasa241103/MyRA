import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { Document } from "@langchain/core/documents";
import embeddingsService from "./embeddings.js";
import { logger } from "../../utils/logger.js";
import { getPool } from "../../config/dbConfig.js";

class LangChainVectorStore {
  constructor() {
    this.vectorStore = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      logger.info("VectorStore already initialized");
      return;
    }

    try {
      logger.info("Initializing LangChain VectorStore...");

      const config = {
        pool: getPool(),
        tableName: "documents",
        columns: {
          idColumnName: "id",
          vectorColumnName: "embedding",
          contentColumnName: "content",
          metadataColumnName: "metadata",
        },
        distanceStrategy: "cosine",
      };

      this.vectorStore = await PGVectorStore.initialize(
        embeddingsService,
        config
      );

      this.initialized = true;
      logger.info("LangChain VectorStore initialized successfully");
    } catch (error) {
      logger.error("Error initializing VectorStore", {
        error: error.message,
      });
      throw error;
    }
  }

  async _ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  async similaritySearch(query, k = 10, filter = null) {
    await this._ensureInitialized();

    try {
      logger.info("Performing similarity search", {
        queryLength: query.length,
        topK: k,
        filter,
      });

      const startTime = Date.now();

      const results = await this.vectorStore.similaritySearchWithScore(
        query,
        k,
        filter
      );

      const duration = Date.now() - startTime;

      logger.info("Similarity search completed", {
        resultCount: results.length,
        durationMs: duration,
      });

      return results.map(([document, score]) => ({
        document_id: document.metadata.document_id || document.id,
        source: document.metadata.source,
        type: document.metadata.type,
        content: document.pageContent,
        metadata: document.metadata,
        similarity: 1 - score,
        distance: score,
      }));
    } catch (error) {
      logger.error("Error performing similarity search", {
        error: error.message,
      });
      throw error;
    }
  }

  asRetriever(k = 10, filter = null) {
    if (!this.initialized) {
      throw new Error("VectorStore not initialized. Call initialize() first.");
    }

    return this.vectorStore.asRetriever({
      k,
      filter,
      searchType: "similarity",
      verbose: false,
    });
  }

  async addDocuments(documents) {
    await this._ensureInitialized();

    try {
      logger.info("Adding documents to vector store", {
        count: documents.length,
      });

      const langchainDocs = documents.map(
        (doc) =>
          new Document({
            pageContent: doc.content,
            metadata: {
              document_id: doc.document_id,
              source: doc.source,
              type: doc.type,
              ...doc.metadata,
            },
          })
      );

      await this.vectorStore.addDocuments(langchainDocs);

      logger.info("Documents added successfully");

      return documents.map((d) => d.document_id);
    } catch (error) {
      logger.error("Error adding documents", {
        error: error.message,
      });
      throw error;
    }
  }

  async deleteDocuments(documentIds) {
    await this._ensureInitialized();

    try {
      logger.info("Deleting documents", { count: documentIds.length });

      await this.vectorStore.delete({
        filter: { document_id: { $in: documentIds } },
      });

      logger.info("Documents deleted successfully");
    } catch (error) {
      logger.error("Error deleting documents", {
        error: error.message,
      });
      throw error;
    }
  }

  async getStats() {
    await this._ensureInitialized();

    try {
      const client = await getPool().connect();

      const stats = await client.query(`
        SELECT
          COUNT(*) as total_documents,
          COUNT(CASE WHEN needs_embedding = false THEN 1 END) as indexed_documents,
          COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as documents_with_embeddings,
          array_agg(DISTINCT source) as sources
        FROM documents
      `);

      client.release();

      return stats.rows[0];
    } catch (error) {
      logger.error("Error getting stats", { error: error.message });
      throw error;
    }
  }

  async healthCheck() {
    try {
      await this._ensureInitialized();
      await this.similaritySearch("test query", 1);
      return true;
    } catch (error) {
      logger.error("VectorStore health check failed", {
        error: error.message,
      });
      return false;
    }
  }

  async close() {
    if (this.vectorStore) {
      await this.vectorStore.end();
      this.vectorStore = null;
      this.initialized = false;
      logger.info("VectorStore connections closed");
    }
  }
}

export default new LangChainVectorStore();
