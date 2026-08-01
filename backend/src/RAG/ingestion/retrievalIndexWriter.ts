import PgVectorStore from "../vectorStores/pgVectorStore.js";
import {
  getVectorStore,
  resolveVectorStoreProvider,
  type VectorStoreProvider,
} from "../vectorStores/vectorStoreFactory.js";
import type VectorStore from "../vectorStores/vectorStore.js";
import type { UpsertDocumentChunksParams } from "../vectorStores/vectorStore.js";

export type RetrievalIndexWriteStage =
  | "postgres_keyword_index"
  | "configured_vector_index";

export interface RetrievalIndexWriteResult {
  provider: VectorStoreProvider;
  chunkCount: number;
  postgresKeywordIndexWritten: boolean;
  configuredVectorIndexWritten: boolean;
}

export interface RetrievalIndexWriterDependencies {
  provider?: VectorStoreProvider;
  vectorStore?: VectorStore;
  postgresStore?: VectorStore;
}

export class RetrievalIndexWriteError extends Error {
  readonly stage: RetrievalIndexWriteStage;
  readonly cause: unknown;

  constructor(stage: RetrievalIndexWriteStage, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Retrieval index write failed at ${stage}: ${message}`);
    this.name = "RetrievalIndexWriteError";
    this.stage = stage;
    this.cause = cause;
  }
}

export default class RetrievalIndexWriter {
  private readonly provider: VectorStoreProvider;
  private readonly vectorStore: VectorStore;
  private readonly postgresStore: VectorStore;

  constructor(dependencies: RetrievalIndexWriterDependencies = {}) {
    this.provider = dependencies.provider ?? resolveVectorStoreProvider();
    this.vectorStore = dependencies.vectorStore ?? getVectorStore();
    this.postgresStore = dependencies.postgresStore ??
      (this.provider === "pgvector" ? this.vectorStore : new PgVectorStore());
  }

  async upsertDocumentChunks(
    params: UpsertDocumentChunksParams,
  ): Promise<RetrievalIndexWriteResult> {
    if (this.provider === "pgvector") {
      try {
        await this.vectorStore.upsertDocumentChunks(params);
      } catch (error) {
        throw new RetrievalIndexWriteError("postgres_keyword_index", error);
      }

      return {
        provider: this.provider,
        chunkCount: params.chunks.length,
        postgresKeywordIndexWritten: true,
        configuredVectorIndexWritten: true,
      };
    }

    try {
      await this.postgresStore.upsertDocumentChunks(params);
    } catch (error) {
      throw new RetrievalIndexWriteError("postgres_keyword_index", error);
    }

    try {
      await this.vectorStore.upsertDocumentChunks(params);
    } catch (error) {
      throw new RetrievalIndexWriteError("configured_vector_index", error);
    }

    return {
      provider: this.provider,
      chunkCount: params.chunks.length,
      postgresKeywordIndexWritten: true,
      configuredVectorIndexWritten: true,
    };
  }
}
