import type { VectorSearchResult } from "../vectorStores/vectorStore.js";

export interface ContextBuilderOptions {
  maxTokens?: number;
  maxChunksPerDocument?: number;
}

export interface ContextBuildResult<T extends VectorSearchResult = VectorSearchResult> {
  text: string;
  chunks: T[];
  estimatedTokens: number;
  excludedChunkCount: number;
}

interface SourceDisplayFields {
  title: string | null;
  author: string | null;
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_MAX_CHUNKS_PER_DOCUMENT = 2;
const EMPTY_CONTEXT = "Retrieved context:\nNo relevant context found in personal data.";

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : fallback;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataRecord(
  result: VectorSearchResult,
): Record<string, unknown> {
  const metadata = result.document?.metadata;
  return metadata && typeof metadata === "object" ? metadata : {};
}

function nestedSourceMetadata(
  result: VectorSearchResult,
  source: "gmail" | "calendar",
): Record<string, unknown> {
  const metadata = metadataRecord(result);
  const nested = metadata[source];
  return nested && typeof nested === "object"
    ? nested as Record<string, unknown>
    : metadata;
}

function calendarOrganizer(metadata: Record<string, unknown>): string | null {
  const organizer = metadata.organizer;
  if (organizer && typeof organizer === "object") {
    const organizerRecord = organizer as Record<string, unknown>;
    return stringValue(organizerRecord.displayName) ??
      stringValue(organizerRecord.email);
  }

  return stringValue(organizer) ??
    stringValue(metadata.organizer_name_norm) ??
    stringValue(metadata.organizer_email);
}

function extractDisplayFields(result: VectorSearchResult): SourceDisplayFields {
  if (result.source_type === "gmail") {
    const metadata = nestedSourceMetadata(result, "gmail");
    return {
      title: stringValue(metadata.subject) ?? stringValue(metadata.title_norm),
      author: stringValue(metadata.from) ??
        stringValue(metadata.sender_name_norm) ??
        stringValue(metadata.sender_email) ??
        result.document?.author ?? null,
    };
  }

  if (result.source_type === "calendar") {
    const metadata = nestedSourceMetadata(result, "calendar");
    return {
      title: stringValue(metadata.summary) ??
        stringValue(metadata.title) ??
        stringValue(metadata.title_norm),
      author: calendarOrganizer(metadata) ?? result.document?.author ?? null,
    };
  }

  const metadata = metadataRecord(result);
  return {
    title: stringValue(metadata.title) ?? stringValue(metadata.title_norm),
    author: stringValue(metadata.author) ??
      stringValue(metadata.author_norm) ??
      result.document?.author ?? null,
  };
}

function displayDate(result: VectorSearchResult): string {
  if (!result.occurred_at) return "unknown date";
  const date = new Date(result.occurred_at);
  return Number.isNaN(date.getTime())
    ? "unknown date"
    : date.toISOString().slice(0, 10);
}

function stripChromaEnvelope(result: VectorSearchResult): string {
  const content = result.content;
  if (metadataRecord(result).schema_version !== "v1") return content;
  if (!content.startsWith("Source:")) return content;

  const separatorIndex = content.indexOf("\n\n");
  if (separatorIndex < 0 || separatorIndex > 1200) return content;

  return content.slice(separatorIndex + 2).trim();
}

function sourceHeader(result: VectorSearchResult, index: number): string {
  const { title, author } = extractDisplayFields(result);
  const headerParts = [
    `[Source ${index}]`,
    result.source_type,
    displayDate(result),
  ];

  if (author) headerParts.push(`from ${author}`);
  if (title) headerParts.push(`- ${title}`);
  return headerParts.join(" ");
}

function documentKey(result: VectorSearchResult): string {
  return String(result.document?.id ?? result.document?.source_id ?? result.chunk_id);
}

function truncateBlock(
  header: string,
  body: string,
  tokenBudget: number,
): string | null {
  const availableCharacters = tokenBudget * CHARS_PER_TOKEN;
  const fixedLength = header.length + 1;
  if (availableCharacters <= fixedLength + 16) return null;

  const bodyLimit = availableCharacters - fixedLength;
  const truncatedBody = body.length > bodyLimit
    ? `${body.slice(0, Math.max(0, bodyLimit - 16)).trim()}... [truncated]`
    : body;

  return `${header}\n${truncatedBody}`;
}

export function buildContextResult<T extends VectorSearchResult>(
  chunks: T[],
  options: ContextBuilderOptions = {},
): ContextBuildResult<T> {
  const maxTokens = positiveInteger(options.maxTokens, DEFAULT_MAX_TOKENS);
  const maxChunksPerDocument = positiveInteger(
    options.maxChunksPerDocument,
    DEFAULT_MAX_CHUNKS_PER_DOCUMENT,
  );

  if (!chunks || chunks.length === 0) {
    return {
      text: EMPTY_CONTEXT,
      chunks: [],
      estimatedTokens: estimateTokens(EMPTY_CONTEXT),
      excludedChunkCount: 0,
    };
  }

  const selectedChunks: T[] = [];
  const sourceBlocks: string[] = [];
  const chunksPerDocument = new Map<string, number>();
  let usedTokens = estimateTokens("Retrieved context:\n\n");

  for (const chunk of chunks) {
    const key = documentKey(chunk);
    const documentChunkCount = chunksPerDocument.get(key) ?? 0;
    if (documentChunkCount >= maxChunksPerDocument) continue;

    const header = sourceHeader(chunk, selectedChunks.length + 1);
    const body = stripChromaEnvelope(chunk).trim();
    const separator = sourceBlocks.length > 0 ? "\n\n---\n\n" : "";
    const separatorTokens = estimateTokens(separator);
    const remainingTokens = maxTokens - usedTokens - separatorTokens;
    if (remainingTokens <= 0) break;

    const block = truncateBlock(header, body, remainingTokens);
    if (!block) continue;

    const blockTokens = estimateTokens(block);
    if (blockTokens + separatorTokens > maxTokens - usedTokens) continue;

    sourceBlocks.push(block);
    selectedChunks.push(chunk);
    chunksPerDocument.set(key, documentChunkCount + 1);
    usedTokens += separatorTokens + blockTokens;
  }

  if (sourceBlocks.length === 0) {
    return {
      text: EMPTY_CONTEXT,
      chunks: [],
      estimatedTokens: estimateTokens(EMPTY_CONTEXT),
      excludedChunkCount: chunks.length,
    };
  }

  const text = `Retrieved context:\n\n${sourceBlocks.join("\n\n---\n\n")}`;
  return {
    text,
    chunks: selectedChunks,
    estimatedTokens: estimateTokens(text),
    excludedChunkCount: chunks.length - selectedChunks.length,
  };
}

export function buildContext(
  chunks: VectorSearchResult[],
  options: ContextBuilderOptions = {},
): string {
  return buildContextResult(chunks, options).text;
}
