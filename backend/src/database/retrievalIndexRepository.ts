import { getPool } from "../config/dbConfig.js";
import type {
  CanonicalDocumentId,
  OwnerId,
  VectorStoreDocument,
} from "../RAG/vectorStores/vectorStore.js";

export interface IndexableDocument extends VectorStoreDocument {
  content: string;
  created_at?: Date | string | null;
  needs_embedding?: boolean | null;
}

export interface FindPendingIndexDocumentsParams {
  userId: OwnerId;
  limit?: number;
  excludeDocumentIds?: CanonicalDocumentId[];
  sourceType?: string | null;
}

export interface RetrievalIndexConsistencyStats {
  readyDocumentCount: number;
  pendingDocumentCount: number;
  missingPostgresChunkDocumentCount: number;
}

export interface QueueMissingIndexDocumentsParams {
  userId: OwnerId;
  limit?: number;
}

export interface CountPendingIndexDocumentsParams {
  userId: OwnerId;
  sourceType?: string | null;
}

export interface FindReadyDocumentIdsParams {
  userId: OwnerId;
  documentIds: CanonicalDocumentId[];
}

const DEFAULT_BATCH_SIZE = 50;

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : fallback;
}

function toIndexableDocument(row: Record<string, unknown>): IndexableDocument {
  return {
    id: row.id as CanonicalDocumentId,
    user_id: row.user_id as OwnerId,
    document_id: String(row.document_id),
    source: String(row.source),
    type: typeof row.type === "string" ? row.type : null,
    content: String(row.content ?? ""),
    title: typeof row.title === "string" ? row.title : null,
    timestamp: row.timestamp as Date | string | null,
    author: typeof row.author === "string" ? row.author : null,
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? row.metadata as Record<string, unknown>
        : null,
    created_at: row.created_at as Date | string | null,
    needs_embedding:
      typeof row.needs_embedding === "boolean"
        ? row.needs_embedding
        : null,
  };
}

export class RetrievalIndexRepository {
  async findPendingDocuments({
    userId,
    limit = DEFAULT_BATCH_SIZE,
    excludeDocumentIds = [],
    sourceType = null,
  }: FindPendingIndexDocumentsParams): Promise<IndexableDocument[]> {
    const normalizedLimit = positiveInteger(limit, DEFAULT_BATCH_SIZE);
    const excludedIds = excludeDocumentIds.map(String);
    const query = `
      SELECT
        d.id,
        d.user_id,
        d.document_id,
        d.source,
        d.type,
        d.content,
        d.title,
        d.timestamp,
        d.author,
        d.metadata,
        d.created_at,
        d.needs_embedding
      FROM documents d
      WHERE d.user_id = $1
        AND d.needs_embedding IS TRUE
        AND NOT (d.id = ANY($3::bigint[]))
        AND ($4::text IS NULL OR d.source = $4)
      ORDER BY d.created_at ASC, d.id ASC
      LIMIT $2`;

    const result = await getPool().query(query, [
      userId,
      normalizedLimit,
      excludedIds,
      sourceType,
    ]);
    return result.rows.map(toIndexableDocument);
  }

  async markDocumentIndexed(
    documentId: CanonicalDocumentId,
    userId: OwnerId,
  ): Promise<void> {
    const query = `
      UPDATE documents
      SET needs_embedding = FALSE,
          updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
      RETURNING id`;

    const result = await getPool().query(query, [documentId, userId]);
    if (result.rows.length === 0) {
      throw new Error(`Document row ${documentId} not found`);
    }
  }

  async countPendingDocuments({
    userId,
    sourceType = null,
  }: CountPendingIndexDocumentsParams): Promise<number> {
    const query = `
      SELECT COUNT(*)::int AS count
      FROM documents d
      WHERE d.user_id = $1
        AND d.needs_embedding IS TRUE
        AND ($2::text IS NULL OR d.source = $2)`;

    const result = await getPool().query(query, [userId, sourceType]);
    return Number(result.rows[0]?.count ?? 0);
  }

  async findReadyDocumentIds({
    userId,
    documentIds,
  }: FindReadyDocumentIdsParams): Promise<Set<string>> {
    const normalizedIds = documentIds
      .map(String)
      .filter((documentId) => /^\d+$/.test(documentId));

    if (normalizedIds.length === 0) return new Set();

    const query = `
      SELECT d.id::text AS id
      FROM documents d
      WHERE d.user_id = $1
        AND d.needs_embedding IS NOT TRUE
        AND d.id = ANY($2::bigint[])`;

    const result = await getPool().query(query, [userId, normalizedIds]);
    return new Set(result.rows.map((row) => String(row.id)));
  }

  async getConsistencyStats(
    userId: OwnerId,
  ): Promise<RetrievalIndexConsistencyStats> {
    const query = `
      SELECT
        COUNT(*) FILTER (
          WHERE d.needs_embedding IS NOT TRUE
        )::int AS ready_document_count,
        COUNT(*) FILTER (
          WHERE d.needs_embedding IS TRUE
        )::int AS pending_document_count,
        COUNT(*) FILTER (
          WHERE d.needs_embedding IS NOT TRUE
            AND NULLIF(TRIM(d.content), '') IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM document_chunks c
              WHERE c.document_id = d.id
            )
        )::int AS missing_postgres_chunk_document_count
      FROM documents d
      WHERE d.user_id = $1`;

    const result = await getPool().query(query, [userId]);
    const row = result.rows[0] ?? {};

    return {
      readyDocumentCount: Number(row.ready_document_count ?? 0),
      pendingDocumentCount: Number(row.pending_document_count ?? 0),
      missingPostgresChunkDocumentCount: Number(
        row.missing_postgres_chunk_document_count ?? 0,
      ),
    };
  }

  async queueDocumentsMissingPostgresChunks({
    userId,
    limit = DEFAULT_BATCH_SIZE,
  }: QueueMissingIndexDocumentsParams): Promise<number> {
    const normalizedLimit = positiveInteger(limit, DEFAULT_BATCH_SIZE);
    const query = `
      WITH missing_documents AS (
        SELECT d.id
        FROM documents d
        WHERE d.user_id = $1
          AND d.needs_embedding IS NOT TRUE
          AND NULLIF(TRIM(d.content), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM document_chunks c
            WHERE c.document_id = d.id
          )
        ORDER BY d.id ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE documents d
      SET needs_embedding = TRUE,
          updated_at = NOW()
      FROM missing_documents missing
      WHERE d.id = missing.id
      RETURNING d.id`;

    const result = await getPool().query(query, [userId, normalizedLimit]);
    return result.rows.length;
  }
}

export const retrievalIndexRepository = new RetrievalIndexRepository();
