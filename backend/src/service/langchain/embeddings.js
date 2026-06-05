import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import { logger } from "../../utils/logger.js";

class LangCHainEmbeddingService {
  constructor() {
    this._queryModel = null;
    this._documentModel = null;
    this.dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || "1536");
  }

  _getModels() {
    if (!this._queryModel || !this._documentModel) {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const modelName =
        process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
      this._queryModel = genAI.getGenerativeModel({ model: modelName });
      this._documentModel = genAI.getGenerativeModel({ model: modelName });
      logger.info("LangChain Embedding Service initialized", {
        model: modelName,
        dimensions: this.dimensions,
      });
    }
    return { queryModel: this._queryModel, documentModel: this._documentModel };
  }

  // Required by PGVectorStore — embeds a single query string
  async embedQuery(text) {
    try {
      const { queryModel } = this._getModels();
      const result = await queryModel.embedContent({
        content: { parts: [{ text: text.trim() }] },
        taskType: TaskType.RETRIEVAL_QUERY,
        outputDimensionality: this.dimensions,
      });
      return result.embedding.values;
    } catch (error) {
      logger.error("Error generating query embedding", error);
      throw error;
    }
  }

  // Required by PGVectorStore — embeds an array of document strings
  async embedDocuments(texts) {
    try {
      const { documentModel } = this._getModels();
      const embeddings = await Promise.all(
        texts.map(async (text) => {
          const result = await documentModel.embedContent({
            content: { parts: [{ text: text.trim() }] },
            taskType: TaskType.RETRIEVAL_DOCUMENT,
            outputDimensionality: this.dimensions,
          });
          return result.embedding.values;
        })
      );

      logger.info("Batch embeddings generated", {
        count: embeddings.length,
        dimensions: embeddings[0]?.length || 0,
      });

      return embeddings;
    } catch (error) {
      logger.error("Error generating batch embeddings", error);
      throw error;
    }
  }

  // Used directly in embeddings.js methods (kept for backward compat)
  async embedDocument(text) {
    return this.embedQuery(text);
  }

  getDimensions() {
    return this.dimensions;
  }

  async healthCheck() {
    try {
      const testEmbedding = await this.embedQuery("test");
      return testEmbedding.length === this.dimensions;
    } catch (error) {
      logger.error("Embeddings health check failed", error);
      return false;
    }
  }
}

export default new LangCHainEmbeddingService();
