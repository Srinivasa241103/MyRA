import type {
  EmbeddedChunk,
  VectorMetadata,
  VectorMetadataValue,
  VectorStoreDocument,
} from "./vectorStore.js";

export interface VectorRecord {
  id: string;
  document: string;
  embedding: number[];
  metadata: VectorMetadata;
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  return normalized || null;
}

function toTimestampMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();

  return Number.isNaN(timestamp) ? null : timestamp;
}

function toDateOnly(value: Date | string | null | undefined): string | null {
  const timestampMs = toTimestampMs(value);
  if (timestampMs === null) return null;

  return new Date(timestampMs).toISOString().slice(0, 10);
}

function toFiniteNumber(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}

function extractEmailAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const match = value.match(/<([^>]+)>/);
  const candidate = match?.[1] || value;
  const trimmed = candidate.trim().toLowerCase();

  return trimmed.includes("@") ? trimmed : null;
}

function extractDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const withoutEmail = value.replace(/<[^>]+>/g, "").trim();
  const normalized = normalizeToken(withoutEmail);

  return normalized || extractEmailAddress(value);
}

function compactMetadata(metadata: Record<string, VectorMetadataValue | undefined>): VectorMetadata {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === "string" && value.length === 0) return false;
      if (typeof value === "number" && !Number.isFinite(value)) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    }),
  ) as VectorMetadata;
}

function buildSourceMetadata(document: VectorStoreDocument): VectorMetadata {
  const sourceMetadata = document.metadata || {};

  if (document.source === "gmail") {
    const gmail = sourceMetadata.gmail as Record<string, unknown> | undefined;
    const from = gmail?.from ?? document.author;

    return compactMetadata({
      message_id: normalizeToken(gmail?.messageId),
      thread_id: normalizeToken(gmail?.threadId),
      title_norm: normalizeToken(gmail?.subject ?? document.title),
      sender_email: extractEmailAddress(from),
      sender_name_norm: extractDisplayName(from),
    });
  }

  if (document.source === "calendar") {
    const calendar = sourceMetadata.calendar as Record<string, unknown> | undefined;
    const organizer = calendar?.organizer as Record<string, unknown> | undefined;
    const organizerValue = organizer?.email ?? document.author;

    return compactMetadata({
      event_id: normalizeToken(calendar?.event_id),
      title_norm: normalizeToken(calendar?.summary ?? document.title),
      organizer_email: extractEmailAddress(organizerValue),
      organizer_name_norm: normalizeToken(
        organizer?.displayName ?? organizer?.email ?? document.author,
      ),
      location_norm: normalizeToken(calendar?.location),
    });
  }

  return compactMetadata({
    title_norm: normalizeToken(document.title),
    author_norm: normalizeToken(document.author),
  });
}

export function buildVectorRecordId(
  document: VectorStoreDocument,
  chunk: EmbeddedChunk,
  schemaVersion = "v1",
): string {
  return [
    "u",
    document.user_id,
    "d",
    document.id,
    "c",
    chunk.chunk_index,
    schemaVersion,
  ].join(":");
}

export function buildVectorDocumentText(
  document: VectorStoreDocument,
  chunk: EmbeddedChunk,
): string {
  const occurredAt = chunk.occurred_at ?? document.timestamp ?? null;
  const timestampMs = toTimestampMs(occurredAt);

  const parts = [
    `Source: ${document.source}`,
    document.type ? `Type: ${document.type}` : null,
    document.title ? `Title: ${document.title}` : null,
    document.author ? `Author: ${document.author}` : null,
    timestampMs !== null ? `Date: ${new Date(timestampMs).toISOString()}` : null,
    "",
    chunk.content,
  ];

  return parts.filter((part) => part !== null).join("\n");
}

export function buildVectorMetadata(
  document: VectorStoreDocument,
  chunk: EmbeddedChunk,
  schemaVersion = "v1",
): VectorMetadata {
  const occurredAt = chunk.occurred_at ?? document.timestamp ?? null;

  return compactMetadata({
    user_id: String(document.user_id),
    document_pk: toFiniteNumber(document.id),
    document_id: document.document_id,
    source: document.source,
    type: document.type ?? null,
    chunk_index: chunk.chunk_index,
    occurred_at_ms: toTimestampMs(occurredAt),
    date_yyyy_mm_dd: toDateOnly(occurredAt),
    schema_version: schemaVersion,
    ...buildSourceMetadata(document),
    ...chunk.metadata,
  });
}

export function mapEmbeddedChunkToVectorRecord(
  document: VectorStoreDocument,
  chunk: EmbeddedChunk,
  schemaVersion = "v1",
): VectorRecord {
  return {
    id: buildVectorRecordId(document, chunk, schemaVersion),
    document: buildVectorDocumentText(document, chunk),
    embedding: chunk.embedding,
    metadata: buildVectorMetadata(document, chunk, schemaVersion),
  };
}

export function mapDocumentChunksToVectorRecords(
  document: VectorStoreDocument,
  chunks: EmbeddedChunk[],
  schemaVersion = "v1",
): VectorRecord[] {
  return chunks.map((chunk) =>
    mapEmbeddedChunkToVectorRecord(document, chunk, schemaVersion),
  );
}
