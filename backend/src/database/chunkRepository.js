import { getPool } from "../config/dbConfig.js";

function compactMetadataFilters(metadata = {}) {
    return Object.fromEntries(
        Object.entries(metadata).filter(([, value]) =>
            value !== null && value !== undefined &&
            (!Array.isArray(value) || value.length > 0)
        )
    );
}

export default class ChunkRepository {
    async insertChunks(document_id, chunks, options = {}) {
        if (!chunks || chunks.length === 0) {
            await getPool().query(
                `DELETE FROM document_chunks
                 WHERE document_id = $1`,
                [document_id]
            );
            return [];
        }

        const values = [document_id];
        const place_holders = chunks.map((chunk, idx) => {
            const base = idx * 5 + 2;

            values.push(
                chunk.content,
                chunk.chunk_index,
                // pgvector expects a "[v1,v2,...]" string cast to ::vector
                `[${chunk.embedding.join(",")}]`,
                chunk.source_type,
                chunk.occurred_at ?? options.occurredAt ?? null
            );

            return `($1, $${base}, $${base + 1}, $${base + 2}::vector, $${base + 3}, $${base + 4})`;
        });

        const query = `WITH deleted AS (
                            DELETE FROM document_chunks
                            WHERE document_id = $1
                        )
                        INSERT INTO document_chunks
                        (document_id, content, chunk_index, embedding, source_type, occurred_at)
                        VALUES ${place_holders.join(", ")}
                        RETURNING *`;

        const result = await getPool().query(query, values);
        return result.rows;
    }

    async deleteChunksByDocumentId(document_id) {
        const query = `DELETE FROM document_chunks dc
                        WHERE dc.document_id = $1`;
        const result = await getPool().query(query, [document_id]);
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
        const metadataFilters = JSON.stringify(
            compactMetadataFilters(options.metadata)
        );

        const query = `
            WITH searchable_chunks AS (
                SELECT 
                    c.id                  AS chunk_id,
                    c.content,
                    c.chunk_index,
                    c.source_type,
                    COALESCE(c.occurred_at, d.timestamp) AS occurred_at,
                    c.embedding <=> $1::vector AS distance,
                    d.id                  AS document_id,
                    d.document_id        AS source_id,
                    d.author,
                    d.metadata,
                    JSONB_STRIP_NULLS(JSONB_BUILD_OBJECT(
                        'user_id', d.user_id::text,
                        'document_pk', d.id,
                        'document_id', d.document_id,
                        'source', d.source,
                        'type', d.type,
                        'chunk_index', c.chunk_index,
                        'schema_version', 'v1',
                        'occurred_at_ms',
                            FLOOR(EXTRACT(EPOCH FROM COALESCE(c.occurred_at, d.timestamp)) * 1000)::bigint,
                        'date_yyyy_mm_dd',
                            TO_CHAR(
                                COALESCE(c.occurred_at, d.timestamp) AT TIME ZONE 'UTC',
                                'YYYY-MM-DD'
                            ),
                        'message_id', CASE WHEN d.source = 'gmail' THEN COALESCE(
                            d.metadata->'gmail'->>'message_id',
                            d.metadata->'gmail'->>'messageId'
                        ) END,
                        'thread_id', CASE WHEN d.source = 'gmail' THEN COALESCE(
                            d.metadata->'gmail'->>'thread_id',
                            d.metadata->'gmail'->>'threadId'
                        ) END,
                        'title_norm', LOWER(TRIM(REGEXP_REPLACE(
                            COALESCE(
                                d.metadata->'gmail'->>'subject',
                                d.metadata->'calendar'->>'summary',
                                d.title
                            ),
                            '\\s+',
                            ' ',
                            'g'
                        ))),
                        'sender_email', CASE WHEN d.source = 'gmail' THEN NULLIF(
                            (REGEXP_MATCH(
                                LOWER(COALESCE(d.metadata->'gmail'->>'from', d.author, '')),
                                '[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}'
                            ))[1],
                            ''
                        ) END,
                        'sender_name_norm', CASE WHEN d.source = 'gmail' THEN NULLIF(
                            LOWER(TRIM(REGEXP_REPLACE(
                                REGEXP_REPLACE(
                                    COALESCE(d.metadata->'gmail'->>'from', d.author, ''),
                                    '<[^>]+>',
                                    '',
                                    'g'
                                ),
                                '\\s+',
                                ' ',
                                'g'
                            ))),
                            ''
                        ) END,
                        'event_id', CASE WHEN d.source = 'calendar' THEN
                            d.metadata->'calendar'->>'event_id'
                        END,
                        'organizer_email', LOWER(NULLIF(COALESCE(
                            d.metadata->'calendar'->'organizer'->>'email',
                            CASE WHEN d.source = 'calendar' THEN d.author END
                        ), '')),
                        'organizer_name_norm', LOWER(NULLIF(TRIM(REGEXP_REPLACE(
                            COALESCE(
                                d.metadata->'calendar'->'organizer'->>'displayName',
                                d.metadata->'calendar'->'organizer'->>'email',
                                CASE WHEN d.source = 'calendar' THEN d.author END
                            ),
                            '\\s+',
                            ' ',
                            'g'
                        )), '')),
                        'location_norm', LOWER(NULLIF(TRIM(REGEXP_REPLACE(
                            d.metadata->'calendar'->>'location',
                            '\\s+',
                            ' ',
                            'g'
                        )), '')),
                        'author_norm', CASE
                            WHEN d.source NOT IN ('gmail', 'calendar') THEN
                                LOWER(NULLIF(TRIM(REGEXP_REPLACE(
                                    d.author,
                                    '\\s+',
                                    ' ',
                                    'g'
                                )), ''))
                        END
                    )) AS search_metadata
                FROM document_chunks c
                JOIN documents d ON c.document_id = d.id
                WHERE d.user_id = $2
                    AND d.needs_embedding IS NOT TRUE
                    AND ($3::text        IS NULL OR c.source_type = $3)
                    AND ($4::timestamptz IS NULL OR COALESCE(c.occurred_at, d.timestamp) >= $4)
                    AND ($5::timestamptz IS NULL OR COALESCE(c.occurred_at, d.timestamp) <= $5)
            ),
            filtered_chunks AS (
                SELECT searchable.*
                FROM searchable_chunks searchable
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM JSONB_EACH($6::jsonb) AS filter(key, value)
                    WHERE CASE
                        WHEN JSONB_TYPEOF(filter.value) = 'array' THEN NOT EXISTS (
                            SELECT 1
                            FROM JSONB_ARRAY_ELEMENTS(filter.value) AS expected(value)
                            WHERE searchable.search_metadata -> filter.key = expected.value
                        )
                        ELSE searchable.search_metadata -> filter.key IS DISTINCT FROM filter.value
                    END
                )
            )
            SELECT
                chunk_id,
                content,
                chunk_index,
                source_type,
                occurred_at,
                distance,
                document_id,
                source_id,
                author,
                metadata
            FROM filtered_chunks
            ORDER BY distance
            LIMIT $7`;

        const values = [
            embeddingLiteral,
            userId,
            sourceType,
            options.occurredAfter,
            options.occurredBefore,
            metadataFilters,
            k,
        ]

        const result = await getPool().query(query, values);

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

}
