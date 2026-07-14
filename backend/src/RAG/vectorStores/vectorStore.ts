export type VectorRecordId = string;
export type OwnerId = string | number;
export type CanonicalDocumentId = string | number;

export type VectorMetadataValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | boolean[];

export type VectorMetadata = Record<string, VectorMetadataValue>;

export interface VectorStoreDocument {
  id: CanonicalDocumentId;
  user_id: OwnerId;
  document_id: string;
  source: string;
  type?: string | null;
  title?: string | null;
  timestamp?: Date | string | null;
  author?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface EmbeddedChunk {
  content: string;
  chunk_index: number;
  source_type: string;
  embedding: number[];
  occurred_at?: Date | string | null;
  metadata?: VectorMetadata;
}

export interface UpsertDocumentChunksParams {
  document: VectorStoreDocument;
  chunks: EmbeddedChunk[];
}

export interface DeleteDocumentChunksParams {
  userId: OwnerId;
  documentId: CanonicalDocumentId;
}

export interface VectorSearchFilters {
  sourceType?: string | null;
  occurredAfter?: Date | string | null;
  occurredBefore?: Date | string | null;
  metadata?: VectorMetadata;
}

export interface VectorSearchParams {
  queryEmbedding: number[];
  userId: OwnerId;
  filters?: VectorSearchFilters;
  topK?: number;
}

export interface VectorSearchResult {
  chunk_id: CanonicalDocumentId;
  content: string;
  chunk_index: number;
  source_type: string;
  occurred_at?: Date | string | null;
  distance: number;
  document: {
    id: CanonicalDocumentId;
    source_id: string;
    author?: string | null;
    metadata?: Record<string, unknown> | null;
  };
}

export default abstract class VectorStore {
  abstract upsertDocumentChunks(
    params: UpsertDocumentChunksParams,
  ): Promise<void>;

  abstract deleteDocumentChunks(params: DeleteDocumentChunksParams): Promise<void>;

  abstract search(params: VectorSearchParams): Promise<VectorSearchResult[]>;
}
