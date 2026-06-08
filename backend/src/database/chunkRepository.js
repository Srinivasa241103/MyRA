import { pool } from "../config/dbConfig.js";

export default class ChunkRepository {
    async insertChunks(document_id, chunks) {
        if (!chunks || chunks.length === 0) return [];

        const values = [];
        const place_holders = chunks.map((chunk, idx) => {
            const base = idx * 5;

            values.push(
                document_id,
                chunk.content,
                chunk.chunk_index,
                // pgvector expects a "[v1,v2,...]" string cast to ::vector
                `[${chunk.embedding.join(",")}]`,
                chunk.source_type
            );

            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::vector, $${base + 5})`;
        });

        const query = `INSERT INTO document_chunks
                        (document_id, content, chunk_index, embedding, source_type)
                        VALUES ${place_holders.join(", ")}
                        RETURNING *`;

        const result = await pool.query(query, values);
        return result.rows;
    }

    async deleteChunksByDocumentId(document_id) {
        const query = `DELETE FROM document_chunks dc
                        WHERE dc.document_id = $1`;
        const result = await pool.query(query, [document_id]);
        return result.rows[0];
    }

    async searchByEmbedding(queryEmbedding, userId, options) {
        const k = options.topK || 10;
        const sourceType = options.sourceType || null;

        if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
            throw new Error('searchByEmbedding requires a non-empty queryEmbedding array');
        }
        if (!Number.isInteger(k) || k <= 0) {
            throw new Error('topK must be a positive integer');
        }

        const embeddingLiteral = `[${queryEmbedding.join(',')}]`;

        const query = `
                SELECT 
                    c.id                  AS chunk_id,
                    c.content,
                    c.chunk_index,
                    c.source_type,
                    c.occurred_at,
                    c.embedding <=> $1::vector AS distance,
                    d.id                  AS document_id,
                    d.document_id        AS source_id,
                    d.author,
                    d.metadata
                FROM document_chunks c
                JOIN documents d ON c.document_id = d.id
                WHERE d.user_id = $2
                    AND ($3::text        IS NULL OR c.source_type = $3)
                    AND ($4::timestamptz IS NULL OR c.occurred_at >= $4)
                    AND ($5::timestamptz IS NULL OR c.occurred_at <= $5)
                ORDER BY c.embedding <=> $1::vector
                LIMIT $6`;

        const values = [
            embeddingLiteral,
            userId,
            sourceType,
            options.occurredAfter,
            options.occurredBefore,
            k,
        ]

        const result = await pool.query(query, values);

        return result.rows.map((row) => ({
            chunk_id: row.chunk_id,
            content: row.content,
            chunk_index: row.chunk_index,
            source_type: row.source_type,
            occurred_at: row.occurred_at,
            distance: parseFloat(row.distance),
            document: {
                id: row.document_id,
                source_id: row.source_id,
                author: row.author,
                metadata: row.metadata,
            },
        }));
    }

    async searchByText(query, options) {

    }
}