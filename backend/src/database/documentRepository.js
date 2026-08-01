import { getPool } from "../config/dbConfig.js";

export class DocumentRepository {
  async create(document) {
    const query = `
      INSERT INTO documents (
        user_id,
        document_id,
        source,
        type,
        content,
        title,
        timestamp,
        author,
        metadata,
        needs_embedding
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
      RETURNING *`;
    const values = [
      document.user_id,
      document.document_id,
      document.source,
      document.type,
      document.content,
      document.title,
      document.timestamp,
      document.author,
      JSON.stringify(document.metadata),
    ];

    try {
      const { rows } = await getPool().query(query, values);
      if (rows.length === 0) {
        throw new Error("Failed to create document");
      }
      return rows[0];
    } catch (error) {
      if (error.code === "23505") {
        throw new Error(`Document with ID ${document.document_id} already exists`);
      }
      throw error;
    }
  }

  async findByDocumentId(documentId, userId) {
    const query = `
      SELECT *
      FROM documents
      WHERE document_id = $1
        AND user_id = $2`;
    const { rows } = await getPool().query(query, [documentId, userId]);
    return rows[0] ?? null;
  }

  async updateForReindex(documentId, userId, document) {
    const query = `
      UPDATE documents
      SET source = $3,
          type = $4,
          content = $5,
          title = $6,
          timestamp = $7,
          author = $8,
          metadata = $9,
          needs_embedding = TRUE,
          updated_at = NOW()
      WHERE document_id = $1
        AND user_id = $2
      RETURNING *`;
    const values = [
      documentId,
      userId,
      document.source,
      document.type,
      document.content,
      document.title,
      document.timestamp,
      document.author,
      JSON.stringify(document.metadata),
    ];
    const { rows } = await getPool().query(query, values);

    if (rows.length === 0) {
      throw new Error(`Document with ID ${documentId} not found`);
    }
    return rows[0];
  }
}
