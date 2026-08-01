import { getPool } from "../config/dbConfig.js";
import type {
  OwnerId,
  VectorSearchFilters,
  VectorSearchResult,
} from "../RAG/vectorStores/vectorStore.js";
import type { RetrievalSort } from "../RAG/retrieval/retrievalPlan.js";

export interface KeywordSearchParams {
  query: string;
  userId: OwnerId;
  filters?: VectorSearchFilters;
  topK?: number;
  k1?: number;
  b?: number;
  sort?: RetrievalSort;
  requireKeywordMatch?: boolean;
}

export interface KeywordSearchResult extends VectorSearchResult {
  keyword_score: number;
  matched_terms: string[];
}

const DEFAULT_TOP_K = 20;
const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function boundedNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : fallback;
}

function compactMetadataFilters(
  metadata: VectorSearchFilters["metadata"],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata ?? {}).filter(([, value]) =>
      value !== null && value !== undefined &&
      (!Array.isArray(value) || value.length > 0)
    ),
  );
}

function toKeywordSearchResult(row: Record<string, unknown>): KeywordSearchResult {
  const keywordScore = Number(row.keyword_score);

  return {
    chunk_id: row.chunk_id as string | number,
    content: String(row.content ?? ""),
    chunk_index: Number(row.chunk_index ?? 0),
    source_type: String(row.source_type ?? "unknown"),
    occurred_at: row.occurred_at as Date | string | null,
    // Keyword-only results have no semantic distance. The fusion executor replaces
    // this with a normalized rank distance when no vector result is available.
    distance: Number.POSITIVE_INFINITY,
    keyword_score: Number.isFinite(keywordScore) ? keywordScore : 0,
    matched_terms: Array.isArray(row.matched_terms)
      ? row.matched_terms.map(String)
      : [],
    document: {
      id: row.document_id as string | number,
      source_id: String(row.source_id ?? ""),
      author: typeof row.author === "string" ? row.author : null,
      metadata:
        row.metadata && typeof row.metadata === "object"
          ? row.metadata as Record<string, unknown>
          : null,
    },
  };
}

export class KeywordSearchRepository {
  async search({
    query,
    userId,
    filters = {},
    topK = DEFAULT_TOP_K,
    k1 = DEFAULT_K1,
    b = DEFAULT_B,
    sort = "relevance",
    requireKeywordMatch = true,
  }: KeywordSearchParams): Promise<KeywordSearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery && requireKeywordMatch) return [];

    if (!userId) {
      throw new Error("Keyword search requires userId");
    }

    const limit = Math.max(1, Math.trunc(positiveNumber(topK, DEFAULT_TOP_K)));
    const normalizedK1 = positiveNumber(k1, DEFAULT_K1);
    const normalizedB = boundedNumber(b, DEFAULT_B, 0, 1);
    const metadataFilters = JSON.stringify(
      compactMetadataFilters(filters.metadata),
    );

    const sql = `
      WITH query_terms AS (
        SELECT
          token AS term,
          COUNT(*)::double precision AS query_frequency
        FROM REGEXP_SPLIT_TO_TABLE(
          LOWER($1),
          '[^[:alnum:]_@.+-]+'
        ) AS token
        WHERE CHAR_LENGTH(token) >= 2
        GROUP BY token
      ),
      base_chunks AS (
        SELECT
          c.id AS chunk_id,
          c.content,
          c.chunk_index,
          c.source_type,
          COALESCE(c.occurred_at, d.timestamp) AS occurred_at,
          d.id AS document_id,
          d.document_id AS source_id,
          d.author,
          d.metadata,
          LOWER(CONCAT_WS(
            ' ',
            d.source,
            d.type,
            d.title,
            d.author,
            c.content
          )) AS search_text,
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
        JOIN documents d ON d.id = c.document_id
        WHERE d.user_id = $2
          AND d.needs_embedding IS NOT TRUE
          AND ($3::text IS NULL OR c.source_type = $3)
          AND ($4::timestamptz IS NULL OR COALESCE(c.occurred_at, d.timestamp) >= $4)
          AND ($5::timestamptz IS NULL OR COALESCE(c.occurred_at, d.timestamp) <= $5)
      ),
      filtered_chunks AS (
        SELECT bc.*
        FROM base_chunks bc
        WHERE NOT EXISTS (
          SELECT 1
          FROM JSONB_EACH($6::jsonb) AS filter(key, value)
          WHERE CASE
            WHEN JSONB_TYPEOF(filter.value) = 'array' THEN NOT EXISTS (
              SELECT 1
              FROM JSONB_ARRAY_ELEMENTS(filter.value) AS expected(value)
              WHERE bc.search_metadata -> filter.key = expected.value
            )
            ELSE bc.search_metadata -> filter.key IS DISTINCT FROM filter.value
          END
        )
      ),
      chunk_tokens AS (
        SELECT
          fc.chunk_id,
          token AS term
        FROM filtered_chunks fc
        CROSS JOIN LATERAL REGEXP_SPLIT_TO_TABLE(
          fc.search_text,
          '[^[:alnum:]_@.+-]+'
        ) AS token
        WHERE CHAR_LENGTH(token) >= 2
      ),
      document_lengths AS (
        SELECT
          fc.chunk_id,
          COUNT(ct.term)::double precision AS document_length
        FROM filtered_chunks fc
        LEFT JOIN chunk_tokens ct ON ct.chunk_id = fc.chunk_id
        GROUP BY fc.chunk_id
      ),
      corpus_stats AS (
        SELECT
          COUNT(*)::double precision AS document_count,
          COALESCE(AVG(document_length), 1)::double precision AS average_document_length
        FROM document_lengths
      ),
      term_frequencies AS (
        SELECT
          ct.chunk_id,
          ct.term,
          COUNT(*)::double precision AS term_frequency,
          MAX(qt.query_frequency)::double precision AS query_frequency
        FROM chunk_tokens ct
        JOIN query_terms qt ON qt.term = ct.term
        GROUP BY ct.chunk_id, ct.term
      ),
      document_frequencies AS (
        SELECT
          term,
          COUNT(*)::double precision AS document_frequency
        FROM term_frequencies
        GROUP BY term
      ),
      bm25_scores AS (
        SELECT
          tf.chunk_id,
          SUM(
            LN(
              1 + (
                (cs.document_count - df.document_frequency + 0.5) /
                (df.document_frequency + 0.5)
              )
            ) *
            (
              (tf.term_frequency * ($7::double precision + 1)) /
              (
                tf.term_frequency +
                $7::double precision * (
                  1 - $8::double precision +
                  $8::double precision *
                    dl.document_length / NULLIF(cs.average_document_length, 0)
                )
              )
            ) *
            tf.query_frequency
          ) AS keyword_score,
          ARRAY_AGG(tf.term ORDER BY tf.term) AS matched_terms
        FROM term_frequencies tf
        JOIN document_frequencies df ON df.term = tf.term
        JOIN document_lengths dl ON dl.chunk_id = tf.chunk_id
        CROSS JOIN corpus_stats cs
        GROUP BY tf.chunk_id
      )
      SELECT
        fc.chunk_id,
        fc.content,
        fc.chunk_index,
        fc.source_type,
        fc.occurred_at,
        fc.document_id,
        fc.source_id,
        fc.author,
        fc.metadata,
        scores.keyword_score,
        scores.matched_terms
      FROM filtered_chunks fc
      LEFT JOIN bm25_scores scores ON fc.chunk_id = scores.chunk_id
      WHERE scores.chunk_id IS NOT NULL OR $11::boolean IS FALSE
      ORDER BY
        CASE WHEN $10::text = 'latest' THEN fc.occurred_at END DESC NULLS LAST,
        CASE WHEN $10::text = 'oldest' THEN fc.occurred_at END ASC NULLS LAST,
        CASE WHEN $10::text = 'relevance' THEN scores.keyword_score END DESC NULLS LAST,
        fc.occurred_at DESC NULLS LAST
      LIMIT $9`;

    const values = [
      normalizedQuery,
      userId,
      filters.sourceType ?? null,
      filters.occurredAfter ?? null,
      filters.occurredBefore ?? null,
      metadataFilters,
      normalizedK1,
      normalizedB,
      limit,
      sort,
      requireKeywordMatch,
    ];

    const result = await getPool().query(sql, values);
    return result.rows.map(toKeywordSearchResult);
  }
}

export const keywordSearchRepository = new KeywordSearchRepository();
