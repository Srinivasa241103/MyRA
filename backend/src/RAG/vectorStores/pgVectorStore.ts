import ChunkRepository from "../../database/chunkRepository.js";
import VectorStore, {
  type DeleteDocumentChunksParams,
  type UpsertDocumentChunksParams,
  type VectorSearchParams,
  type VectorSearchResult,
} from "./vectorStore.js";

export default class PgVectorStore extends VectorStore {
  private readonly chunkRepository: ChunkRepository;

  constructor(chunkRepository = new ChunkRepository()) {
    super();
    this.chunkRepository = chunkRepository;
  }

  async upsertDocumentChunks({
    document,
    chunks,
  }: UpsertDocumentChunksParams): Promise<void> {
    if (!document?.id) {
      throw new Error("document.id is required to store vector chunks");
    }

    await this.chunkRepository.insertChunks(document.id, chunks, {
      occurredAt: document.timestamp ?? null,
    });
  }

  async deleteDocumentChunks({
    documentId,
  }: DeleteDocumentChunksParams): Promise<void> {
    if (!documentId) {
      throw new Error("documentId is required to delete vector chunks");
    }

    await this.chunkRepository.deleteChunksByDocumentId(documentId);
  }

  async search({
    queryEmbedding,
    userId,
    filters = {},
    topK = 10,
  }: VectorSearchParams): Promise<VectorSearchResult[]> {
    return this.chunkRepository.searchByEmbedding(queryEmbedding, userId, {
      topK,
      sourceType: filters.sourceType ?? null,
      occurredAfter: filters.occurredAfter ?? null,
      occurredBefore: filters.occurredBefore ?? null,
    });
  }
}
