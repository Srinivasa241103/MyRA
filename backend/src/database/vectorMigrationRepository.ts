import { getPool } from "../config/dbConfig.js";

export interface PgvectorMigrationChunkRow {
  chunk_id: number;
  content: string;
  chunk_index: number;
  source_type: string;
  occurred_at: Date | string | null;
  embedding_text: string;
  document_pk: number;
  user_id: number | string;
  document_id: string;
  source: string;
  type: string | null;
  title: string | null;
  timestamp: Date | string | null;
  author: string | null;
  metadata: Record<string, unknown> | null;
}

export interface FetchMigrationChunkBatchParams {
  limit: number;
  afterDocumentPk: number;
  userId: string | null;
}

export class VectorMigrationRepository {
  async fetchDocumentChunkBatch({
    limit,
    afterDocumentPk,
    userId,
  }: FetchMigrationChunkBatchParams): Promise<PgvectorMigrationChunkRow[]> {
    const values: Array<string | number> = [];
    let userFilter = "";

    if (userId) {
      values.push(userId);
      userFilter = `AND d.user_id = $${values.length}`;
    }

    values.push(afterDocumentPk, limit);
    const afterDocumentParam = values.length - 1;
    const limitParam = values.length;
    const query = `
      WITH batch_documents AS (
        SELECT d.id
        FROM documents d
        WHERE d.id > $${afterDocumentParam}
          ${userFilter}
          AND EXISTS (
            SELECT 1
            FROM document_chunks c
            WHERE c.document_id = d.id
              AND c.embedding IS NOT NULL
          )
        ORDER BY d.id ASC
        LIMIT $${limitParam}
      )
      SELECT
        c.id AS chunk_id,
        c.content,
        c.chunk_index,
        c.source_type,
        COALESCE(c.occurred_at, d.timestamp) AS occurred_at,
        c.embedding::text AS embedding_text,
        d.id AS document_pk,
        d.user_id,
        d.document_id,
        d.source,
        d.type,
        d.title,
        d.timestamp,
        d.author,
        d.metadata
      FROM batch_documents bd
      JOIN documents d ON d.id = bd.id
      JOIN document_chunks c ON c.document_id = d.id
      WHERE c.embedding IS NOT NULL
      ORDER BY d.id ASC, c.chunk_index ASC`;

    const result = await getPool().query(query, values);
    return result.rows as PgvectorMigrationChunkRow[];
  }

  async countSourceChunks(userId: string | null): Promise<number> {
    const values: string[] = [];
    let userFilter = "";

    if (userId) {
      values.push(userId);
      userFilter = `AND d.user_id = $${values.length}`;
    }

    const query = `
      SELECT COUNT(*)::int AS count
      FROM document_chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE c.embedding IS NOT NULL
        ${userFilter}`;
    const result = await getPool().query(query, values);
    return Number(result.rows[0]?.count ?? 0);
  }
}

export const vectorMigrationRepository = new VectorMigrationRepository();
