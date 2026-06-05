import { pool } from "../config/dbConfig.js";

export default class ChunkRepository {
    contructor() {

    }

    async insertChunks(document_id, chunks) {
        const values = [];
        const place_holders = chunks.map((chunk, idx) => {

            values.push(
                document_id,
                chunk.content,
                chunk.chunk_index,
                chunk.embedding,
            );

            return `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4})`;
        });

        const query = `INSERT INTO document_chunks
                        (document_id, content, chunk_id, embedding)
                        VALUES (${place_holders.join(", ")}) `;

        const result = await pool.query(query, values);
        return result.rows[0];
    }

    async deleteChunksByDocumentId(document_id) {
        const query = `DELETE FROM document_chunks dc
                        WHERE dc.document_id = $1`;
        const result = await pool.query(query, [document_id]);
        return result.rows[0];
    }

    async searchByEmbedding(queryEmbedding, options) {

    }

    async searchByText(query, options) {

    }
}