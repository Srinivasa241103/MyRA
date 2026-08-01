import { getPool } from "../config/dbConfig.js";

export type MetadataPersonRole = "sender" | "organizer";
export type MetadataPersonSource = "gmail" | "calendar";

export interface MetadataPersonCandidate {
  role: MetadataPersonRole;
  source: MetadataPersonSource;
  nameMetadataKey: string;
  emailMetadataKey: string;
  normalizedName: string | null;
  email: string | null;
  documentCount: number;
  latestTimestamp: Date | string | null;
}

export interface FindPersonCandidatesParams {
  userId: string | number;
  role: MetadataPersonRole;
  queryText: string;
  limit?: number;
}

const DEFAULT_PERSON_CANDIDATE_LIMIT = 25;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

function normalizeSearchTokens(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[<>"'()[\]{}]/g, " ")
        .replace(/[^\p{L}\p{N}@._+-]+/gu, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  ];
}

function buildSearchPatterns(queryText: string): string[] {
  const normalized = queryText.trim().toLowerCase();
  const email = normalized.match(EMAIL_PATTERN)?.[0];

  if (email) {
    return [`%${email}%`];
  }

  return normalizeSearchTokens(queryText).map((token) => `%${token}%`);
}

function toCandidate(row: Record<string, unknown>): MetadataPersonCandidate {
  return {
    role: row.role as MetadataPersonRole,
    source: row.source as MetadataPersonSource,
    nameMetadataKey: String(row.name_metadata_key),
    emailMetadataKey: String(row.email_metadata_key),
    normalizedName:
      typeof row.normalized_name === "string" ? row.normalized_name : null,
    email: typeof row.email === "string" ? row.email : null,
    documentCount: Number(row.document_count ?? 0),
    latestTimestamp: row.latest_timestamp as Date | string | null,
  };
}

export class RetrievalMetadataRepository {
  async findPersonCandidates({
    userId,
    role,
    queryText,
    limit = DEFAULT_PERSON_CANDIDATE_LIMIT,
  }: FindPersonCandidatesParams): Promise<MetadataPersonCandidate[]> {
    if (role === "sender") {
      return this.findGmailSenderCandidates({ userId, queryText, limit });
    }

    return this.findCalendarOrganizerCandidates({ userId, queryText, limit });
  }

  private async findGmailSenderCandidates({
    userId,
    queryText,
    limit,
  }: Omit<FindPersonCandidatesParams, "role">): Promise<MetadataPersonCandidate[]> {
    const patterns = buildSearchPatterns(queryText);
    if (patterns.length === 0) return [];

    const query = `
      WITH raw_people AS (
        SELECT
          NULLIF(
            LOWER(TRIM(REGEXP_REPLACE(
              COALESCE(d.metadata->'gmail'->>'from', d.author, ''),
              '<[^>]+>',
              '',
              'g'
            ))),
            ''
          ) AS normalized_name,
          NULLIF(
            (REGEXP_MATCH(
              LOWER(COALESCE(d.metadata->'gmail'->>'from', d.author, '')),
              '[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}'
            ))[1],
            ''
          ) AS email,
          d.timestamp
        FROM documents d
        WHERE d.user_id = $1
          AND d.needs_embedding IS NOT TRUE
          AND d.source = 'gmail'
      ),
      people AS (
        SELECT
          normalized_name,
          email,
          COUNT(*)::int AS document_count,
          MAX(timestamp) AS latest_timestamp
        FROM raw_people
        WHERE normalized_name IS NOT NULL
           OR email IS NOT NULL
        GROUP BY normalized_name, email
      )
      SELECT
        'sender' AS role,
        'gmail' AS source,
        'sender_name_norm' AS name_metadata_key,
        'sender_email' AS email_metadata_key,
        normalized_name,
        email,
        document_count,
        latest_timestamp
      FROM people
      WHERE normalized_name ILIKE ANY($2::text[])
         OR email ILIKE ANY($2::text[])
      ORDER BY document_count DESC, latest_timestamp DESC
      LIMIT $3`;

    const result = await getPool().query(query, [userId, patterns, limit]);
    return result.rows.map(toCandidate);
  }

  private async findCalendarOrganizerCandidates({
    userId,
    queryText,
    limit,
  }: Omit<FindPersonCandidatesParams, "role">): Promise<MetadataPersonCandidate[]> {
    const patterns = buildSearchPatterns(queryText);
    if (patterns.length === 0) return [];

    const query = `
      WITH raw_people AS (
        SELECT
          NULLIF(
            LOWER(TRIM(COALESCE(
              d.metadata->'calendar'->'organizer'->>'displayName',
              d.metadata->'calendar'->'organizer'->>'email',
              d.author,
              ''
            ))),
            ''
          ) AS normalized_name,
          NULLIF(
            (REGEXP_MATCH(
              LOWER(COALESCE(
                d.metadata->'calendar'->'organizer'->>'email',
                d.author,
                ''
              )),
              '[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}'
            ))[1],
            ''
          ) AS email,
          d.timestamp
        FROM documents d
        WHERE d.user_id = $1
          AND d.needs_embedding IS NOT TRUE
          AND d.source = 'calendar'
      ),
      people AS (
        SELECT
          normalized_name,
          email,
          COUNT(*)::int AS document_count,
          MAX(timestamp) AS latest_timestamp
        FROM raw_people
        WHERE normalized_name IS NOT NULL
           OR email IS NOT NULL
        GROUP BY normalized_name, email
      )
      SELECT
        'organizer' AS role,
        'calendar' AS source,
        'organizer_name_norm' AS name_metadata_key,
        'organizer_email' AS email_metadata_key,
        normalized_name,
        email,
        document_count,
        latest_timestamp
      FROM people
      WHERE normalized_name ILIKE ANY($2::text[])
         OR email ILIKE ANY($2::text[])
      ORDER BY document_count DESC, latest_timestamp DESC
      LIMIT $3`;

    const result = await getPool().query(query, [userId, patterns, limit]);
    return result.rows.map(toCandidate);
  }
}

export const retrievalMetadataRepository = new RetrievalMetadataRepository();
