/**
 * FND-06 — deterministic fixtures and recording doubles for the baseline suite.
 *
 * Nothing here touches PostgreSQL, Chroma, Redis, Google, or an LLM provider.
 * Every double records the arguments it was called with so a baseline test can
 * assert on the *boundary* (user scope, filters, source metadata) rather than
 * on a live service's behaviour.
 *
 * Two users exist on purpose: OWNER is the caller in every test, INTRUDER owns
 * the rows a leaky implementation would return. The mutation guards
 * (test/baseline/mutationGuards.baseline.test.ts) reuse the same fixtures with
 * the user filter or the source metadata deliberately removed.
 */

import type {
  EmbeddedChunk,
  VectorSearchFilters,
  VectorSearchParams,
  VectorSearchResult,
  VectorStoreDocument,
} from "../../src/RAG/vectorStores/vectorStore.js";
import type { KeywordSearchResult } from "../../src/database/keywordSearchRepository.js";
import type {
  RankedSearchResult,
} from "../../src/RAG/retrieval/hybridSearchExecutor.js";
import type {
  PersonFilter,
  RetrievalSourceScope,
} from "../../src/RAG/retrieval/retrievalPlan.js";

/* -------------------------------------------------------------------------- */
/* identities and clock                                                        */
/* -------------------------------------------------------------------------- */

/** Numeric because requireAuth.getAuthenticatedUserId only accepts positive integers. */
export const OWNER_USER_ID = 101;
export const INTRUDER_USER_ID = 202;

export const FIXED_NOW = new Date("2026-08-03T09:00:00.000Z");

export const CONVERSATION_ID = "conversation-fnd06";

/* -------------------------------------------------------------------------- */
/* retrieval fixtures                                                          */
/* -------------------------------------------------------------------------- */

export interface VectorResultOverrides {
  chunkId?: string;
  documentPk?: number;
  sourceId?: string;
  sourceType?: "gmail" | "calendar";
  content?: string;
  chunkIndex?: number;
  distance?: number;
  occurredAt?: string;
  author?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * A vector hit shaped exactly like ChromaVectorStore.search / pgVectorStore
 * return it: flat chunk fields plus a nested `document` carrying the source
 * metadata the context builder reads.
 */
export function vectorResult(
  overrides: VectorResultOverrides = {},
): VectorSearchResult {
  const sourceType = overrides.sourceType ?? "gmail";
  const documentPk = overrides.documentPk ?? 1;
  const sourceId = overrides.sourceId ??
    `${sourceType === "gmail" ? "gmail" : "calendar"}_${documentPk}`;

  const defaultMetadata: Record<string, unknown> = sourceType === "gmail"
    ? {
      user_id: String(OWNER_USER_ID),
      document_pk: documentPk,
      document_id: sourceId,
      source: "gmail",
      schema_version: "v1",
      sender_email: "anand@example.com",
      sender_name_norm: "anand rao",
      subject: "Quarterly roadmap review",
      from: "Anand Rao <anand@example.com>",
      title_norm: "quarterly roadmap review",
    }
    : {
      user_id: String(OWNER_USER_ID),
      document_pk: documentPk,
      document_id: sourceId,
      source: "calendar",
      schema_version: "v1",
      organizer_email: "priya@example.com",
      organizer_name_norm: "priya menon",
      summary: "Design sync",
      title_norm: "design sync",
    };

  return {
    chunk_id: overrides.chunkId ?? `chunk-${documentPk}-${overrides.chunkIndex ?? 0}`,
    content: overrides.content ??
      (sourceType === "gmail"
        ? "Anand shared the quarterly roadmap and asked for review comments by Friday."
        : "Design sync with Priya to walk through the retrieval UI states."),
    chunk_index: overrides.chunkIndex ?? 0,
    source_type: sourceType,
    occurred_at: overrides.occurredAt ?? "2026-08-01T10:00:00.000Z",
    distance: overrides.distance ?? 0.12,
    document: {
      id: documentPk,
      source_id: sourceId,
      author: overrides.author === undefined
        ? (sourceType === "gmail" ? "anand@example.com" : "priya@example.com")
        : overrides.author,
      metadata: overrides.metadata === undefined
        ? defaultMetadata
        : overrides.metadata,
    },
  };
}

export interface KeywordResultOverrides extends VectorResultOverrides {
  keywordScore?: number;
  matchedTerms?: string[];
}

/** A BM25 hit from keywordSearchRepository — a VectorSearchResult plus lexical fields. */
export function keywordResult(
  overrides: KeywordResultOverrides = {},
): KeywordSearchResult {
  const base = vectorResult(overrides);

  return {
    ...base,
    keyword_score: overrides.keywordScore ?? 3.5,
    matched_terms: overrides.matchedTerms ?? ["roadmap"],
  };
}

/** A fully ranked result, i.e. what the Retriever hands to the QueryPipeline. */
export function rankedResult(
  overrides: VectorResultOverrides & {
    fusionScore?: number;
    vectorRank?: number | null;
    keywordRank?: number | null;
  } = {},
): RankedSearchResult {
  const base = vectorResult(overrides);

  return {
    ...base,
    retrieval: {
      strategy: "hybrid",
      fusion_score: overrides.fusionScore ?? 0.032,
      vector_rank: overrides.vectorRank ?? 1,
      keyword_rank: overrides.keywordRank ?? 1,
      vector_distance: base.distance,
      keyword_score: 3.5,
      matched_terms: ["roadmap"],
      rerank_score: null,
      rerank_rank: null,
    },
  };
}

/** Rows a leaking implementation would return: same shape, other user's data. */
export function intruderVectorResult(): VectorSearchResult {
  return vectorResult({
    documentPk: 99,
    sourceId: "gmail_intruder",
    content: "Salary review notes that belong to another account.",
    metadata: {
      user_id: String(INTRUDER_USER_ID),
      document_pk: 99,
      document_id: "gmail_intruder",
      source: "gmail",
      schema_version: "v1",
      sender_email: "hr@example.com",
    },
  });
}

/* -------------------------------------------------------------------------- */
/* recording doubles — retrieval                                               */
/* -------------------------------------------------------------------------- */

export interface RecordedVectorSearch {
  userId: string | number;
  topK: number | undefined;
  filters: VectorSearchFilters | undefined;
  queryEmbedding: number[];
}

export class RecordingVectorStore {
  readonly calls: RecordedVectorSearch[] = [];

  constructor(
    private readonly results: VectorSearchResult[] = [vectorResult()],
    private readonly failure: Error | null = null,
  ) {}

  async search(params: VectorSearchParams): Promise<VectorSearchResult[]> {
    this.calls.push({
      userId: params.userId,
      topK: params.topK,
      filters: params.filters,
      queryEmbedding: params.queryEmbedding,
    });

    if (this.failure) throw this.failure;

    // Honour the user filter the way a correct store does: only rows whose
    // metadata user_id matches the caller are visible.
    return this.results.filter((result) =>
      String(result.document.metadata?.user_id ?? params.userId) ===
        String(params.userId)
    );
  }
}

export interface RecordedKeywordSearch {
  query: string;
  userId: string | number;
  topK: number | undefined;
  filters: VectorSearchFilters | undefined;
  sort: string | undefined;
  requireKeywordMatch: boolean | undefined;
}

export class RecordingKeywordRepository {
  readonly calls: RecordedKeywordSearch[] = [];

  constructor(
    private readonly results: KeywordSearchResult[] = [keywordResult()],
    private readonly failure: Error | null = null,
  ) {}

  async search(params: {
    query: string;
    userId: string | number;
    topK?: number;
    filters?: VectorSearchFilters;
    sort?: string;
    requireKeywordMatch?: boolean;
  }): Promise<KeywordSearchResult[]> {
    this.calls.push({
      query: params.query,
      userId: params.userId,
      topK: params.topK,
      filters: params.filters,
      sort: params.sort,
      requireKeywordMatch: params.requireKeywordMatch,
    });

    if (this.failure) throw this.failure;

    return this.results.filter((result) =>
      String(result.document.metadata?.user_id ?? params.userId) ===
        String(params.userId)
    );
  }
}

export class StubEmbedding {
  readonly calls: Array<{ query: string; userId: string | number }> = [];

  async embedQuery(
    query: string,
    context: { userId: string | number; conversationId: string },
  ): Promise<number[]> {
    this.calls.push({ query, userId: context.userId });
    return [0.1, 0.2, 0.3];
  }
}

/** Rerank is an LLM call; the baseline freezes the pass-through path only. */
export class PassThroughReranker {
  readonly calls: Array<{ query: string; candidateCount: number }> = [];

  async rerank({
    query,
    candidates,
    finalTopK,
    enabled,
  }: {
    query: string;
    candidates: RankedSearchResult[];
    finalTopK: number;
    enabled?: boolean;
  }) {
    this.calls.push({ query, candidateCount: candidates.length });

    return {
      results: candidates.slice(0, finalTopK),
      diagnostics: {
        enabled: enabled ?? true,
        attempted: false,
        applied: false,
        candidateCount: candidates.length,
        returnedCount: Math.min(candidates.length, finalTopK),
        skippedReason: "disabled" as const,
      },
    };
  }
}

/** Person resolution is a database lookup; the double returns a fixed verdict. */
export class StubPersonResolver {
  readonly calls: Array<{ userId: string | number; source: RetrievalSourceScope }> = [];

  constructor(private readonly decorate: (person: PersonFilter) => PersonFilter) {}

  async resolvePeople({
    people,
    userId,
    source,
  }: {
    people: PersonFilter[];
    userId: string | number;
    source: RetrievalSourceScope;
  }): Promise<PersonFilter[]> {
    this.calls.push({ userId, source });
    return people.map(this.decorate);
  }
}

export const resolvePersonAs = {
  resolved: (person: PersonFilter): PersonFilter => ({
    ...person,
    status: "resolved",
    resolvedName: "anand rao",
    email: "anand@example.com",
    metadataKey: "sender_email",
    metadataValue: "anand@example.com",
    confidence: 0.97,
    candidates: [],
  }),
  ambiguous: (person: PersonFilter): PersonFilter => ({
    ...person,
    status: "ambiguous",
    confidence: 0.61,
    candidates: [
      {
        metadataKey: "sender_email",
        metadataValue: "anand@example.com",
        normalizedName: "anand rao",
        email: "anand@example.com",
        score: 0.61,
        documentCount: 12,
      },
      {
        metadataKey: "sender_email",
        metadataValue: "anand.k@example.com",
        normalizedName: "anand kumar",
        email: "anand.k@example.com",
        score: 0.58,
        documentCount: 4,
      },
    ],
  }),
  unresolved: (person: PersonFilter): PersonFilter => ({
    ...person,
    status: "unresolved",
    candidates: [],
  }),
};

/* -------------------------------------------------------------------------- */
/* recording doubles — pipeline collaborators                                  */
/* -------------------------------------------------------------------------- */

export interface RecordedSave {
  userId: string | number;
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
  metadata: Record<string, unknown>;
}

export class RecordingMemoryService {
  readonly saves: RecordedSave[] = [];
  readonly historyCalls: Array<{ conversationId: string; userId: string | number }> = [];

  constructor(private readonly history: Array<{ role: string; content: string }> = []) {}

  async loadHistory(conversationId: string, userId: string | number) {
    this.historyCalls.push({ conversationId, userId });
    return this.history;
  }

  async saveConversation(
    userId: string | number,
    conversationId: string,
    userMessage: string,
    assistantMessage: string,
    metadata: Record<string, unknown> = {},
  ) {
    this.saves.push({
      userId,
      conversationId,
      userMessage,
      assistantMessage,
      metadata,
    });
  }
}

export interface RecordedLLMCall {
  provider: string;
  messages: Array<{ role: string; content: string }>;
  userId: string | number;
  conversationId: string;
  invocationType?: string;
  streamed: boolean;
}

export class RecordingLLMService {
  readonly calls: RecordedLLMCall[] = [];

  constructor(
    private readonly tokens: string[] = ["Anand ", "shared ", "the roadmap."],
    private readonly options: { stopped?: boolean; failWith?: Error } = {},
  ) {}

  private get answer(): string {
    return this.tokens.join("");
  }

  async generateResponse(
    llmProvider: string,
    messages: Array<{ role: string; content: string }>,
    userId: string | number,
    conversationId: string,
    options: { model?: string | null; invocationType?: string } = {},
  ) {
    this.calls.push({
      provider: llmProvider,
      messages,
      userId,
      conversationId,
      invocationType: options.invocationType,
      streamed: false,
    });

    if (this.options.failWith) throw this.options.failWith;

    return {
      answer: this.answer,
      provider: llmProvider,
      model: options.model ?? "gpt-test",
      duration: 5,
      stopped: Boolean(this.options.stopped),
    };
  }

  async generateResponseStream(
    llmProvider: string,
    messages: Array<{ role: string; content: string }>,
    userId: string | number,
    conversationId: string,
    options: {
      model?: string | null;
      invocationType?: string;
      signal?: AbortSignal;
      onToken?: (text: string) => void | Promise<void>;
    } = {},
  ) {
    this.calls.push({
      provider: llmProvider,
      messages,
      userId,
      conversationId,
      invocationType: options.invocationType,
      streamed: true,
    });

    if (this.options.failWith) throw this.options.failWith;

    for (const token of this.tokens) {
      options.signal?.throwIfAborted();
      await options.onToken?.(token);
    }

    return {
      answer: this.answer,
      provider: llmProvider,
      model: options.model ?? "gpt-test",
      duration: 5,
      stopped: Boolean(this.options.stopped),
    };
  }
}

/** Query rewrite calls generateStructuredResponse; this double freezes both outcomes. */
export class StructuredLLMDouble {
  readonly calls: Array<{
    invocationType?: string;
    userId: string | number;
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
  }> = [];

  constructor(
    private readonly response: unknown,
    private readonly failure: Error | null = null,
  ) {}

  async generateStructuredResponse(params: {
    invocationType?: string;
    userId: string | number;
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
  }): Promise<unknown> {
    this.calls.push({
      invocationType: params.invocationType,
      userId: params.userId,
      conversationId: params.conversationId,
      messages: params.messages,
    });

    if (this.failure) throw this.failure;
    return this.response;
  }
}

/* -------------------------------------------------------------------------- */
/* recording doubles — persistence                                             */
/* -------------------------------------------------------------------------- */

export interface RecordedQuery {
  sql: string;
  params: unknown[];
}

/** Stands in for the pg Pool: records SQL and returns a canned result set. */
export class RecordingDatabase {
  readonly queries: RecordedQuery[] = [];

  constructor(
    private readonly result: { rows: Record<string, unknown>[]; rowCount?: number } = {
      rows: [],
      rowCount: 0,
    },
  ) {}

  async query(sql: string, params: unknown[] = []) {
    this.queries.push({ sql, params });
    return {
      rows: this.result.rows,
      rowCount: this.result.rowCount ?? this.result.rows.length,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP doubles                                                                */
/* -------------------------------------------------------------------------- */

export interface SseFrame {
  type: string;
  queryId?: string;
  conversationId?: string;
  data: unknown;
}

/**
 * Minimal Express `res` that captures written SSE bytes plus any JSON reply.
 * `res` doubles as an EventEmitter for the "close" listener the controller adds.
 */
export class FakeResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  jsonBody: unknown = null;
  chunks: string[] = [];
  writableEnded = false;
  destroyed = false;
  headersFlushed = false;

  private readonly listeners = new Map<string, Array<() => void>>();

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  flushHeaders() {
    this.headersFlushed = true;
  }

  write(value: string) {
    this.chunks.push(value);
    return true;
  }

  json(body: unknown) {
    this.jsonBody = body;
    return this;
  }

  end() {
    this.writableEnded = true;
    this.emit("finish");
  }

  once(event: string, listener: () => void) {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  emit(event: string) {
    for (const listener of this.listeners.get(event) ?? []) listener();
    this.listeners.delete(event);
  }

  /** Parsed SSE frames in wire order; heartbeat comments are excluded. */
  get frames(): SseFrame[] {
    return this.chunks
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => JSON.parse(chunk.slice("data: ".length).trim()) as SseFrame);
  }

  get frameTypes(): string[] {
    return this.frames.map((frame) => frame.type);
  }
}

export class FakeRequest {
  readonly body: Record<string, unknown>;
  readonly params: Record<string, string>;
  readonly query: Record<string, string>;
  readonly user: { userId: number; authType: string } | undefined;

  private readonly listeners = new Map<string, Array<() => void>>();

  constructor({
    body = {},
    params = {},
    query = {},
    userId = OWNER_USER_ID,
  }: {
    body?: Record<string, unknown>;
    params?: Record<string, string>;
    query?: Record<string, string>;
    userId?: number | null;
  } = {}) {
    this.body = body;
    this.params = params;
    this.query = query;
    this.user = userId === null ? undefined : { userId, authType: "jwt" };
  }

  once(event: string, listener: () => void) {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  emit(event: string) {
    for (const listener of this.listeners.get(event) ?? []) listener();
    this.listeners.delete(event);
  }
}

/* -------------------------------------------------------------------------- */
/* Google provider payloads                                                    */
/* -------------------------------------------------------------------------- */

function base64Url(value: string): string {
  return Buffer.from(value, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export const GMAIL_PLAIN_MESSAGE = {
  id: "18f0aa11bb22cc33",
  threadId: "18f0aa11bb22cc00",
  labelIds: ["INBOX", "IMPORTANT"],
  snippet: "Roadmap review comments by Friday",
  internalDate: "1754042400000", // 2026-08-01T10:00:00.000Z
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: "Anand Rao <anand@example.com>" },
      { name: "To", value: "me@example.com" },
      { name: "Subject", value: "Quarterly roadmap review" },
      { name: "Date", value: "Sat, 01 Aug 2026 15:30:00 +0530" },
    ],
    body: { data: base64Url("Please send roadmap review comments by Friday.") },
  },
};

export const GMAIL_MULTIPART_MESSAGE = {
  id: "18f0aa11bb22cc44",
  threadId: "18f0aa11bb22cc00",
  labelIds: ["INBOX"],
  snippet: "Nested multipart",
  internalDate: "1754046000000",
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: "Priya Menon <priya@example.com>" },
      { name: "Subject", value: "Design sync notes" },
    ],
    parts: [
      {
        mimeType: "multipart/related",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: base64Url("Notes from the design sync.") },
          },
        ],
      },
      {
        mimeType: "text/html",
        body: { data: base64Url("<p>Notes from the design sync.</p>") },
      },
    ],
  },
};

export const GMAIL_HTML_MESSAGE = {
  id: "18f0aa11bb22cc55",
  threadId: "18f0aa11bb22cc55",
  labelIds: [],
  snippet: "HTML only",
  internalDate: "1754049600000",
  payload: {
    mimeType: "text/html",
    headers: [{ name: "Subject", value: "Release notes" }],
    body: {
      data: base64Url(
        "<style>p{color:red}</style><script>alert(1)</script><p>Release&nbsp;v2 &amp; notes</p>",
      ),
    },
  },
};

export const GMAIL_EMPTY_MESSAGE = {
  id: "18f0aa11bb22cc66",
  threadId: "18f0aa11bb22cc66",
  labelIds: [],
  snippet: "",
  internalDate: "1754053200000",
  payload: {
    mimeType: "text/plain",
    headers: [{ name: "Subject", value: "Empty" }],
    body: { data: base64Url("   ") },
  },
};

export const CALENDAR_TIMED_EVENT = {
  id: "evt_9001",
  status: "confirmed",
  summary: "Design sync",
  description: "<p>Walk through the retrieval UI &amp; states</p>",
  location: "Meet",
  htmlLink: "https://calendar.google.com/event?eid=evt_9001",
  start: { dateTime: "2026-08-01T10:00:00.000Z" },
  end: { dateTime: "2026-08-01T10:30:00.000Z" },
  organizer: { email: "priya@example.com", displayName: "Priya Menon" },
  attendees: [
    { email: "me@example.com", responseStatus: "accepted", self: true },
    { email: "anand@example.com", displayName: "Anand Rao" },
  ],
};

export const CALENDAR_ALL_DAY_EVENT = {
  id: "evt_9002",
  status: "confirmed",
  summary: "Company offsite",
  start: { date: "2026-08-05" },
  end: { date: "2026-08-06" },
  organizer: { email: "ops@example.com" },
  recurrence: ["RRULE:FREQ=YEARLY"],
};

export const CALENDAR_CANCELLED_EVENT = {
  id: "evt_9003",
  status: "cancelled",
  summary: "Cancelled review",
  start: { dateTime: "2026-08-02T10:00:00.000Z" },
  end: { dateTime: "2026-08-02T10:30:00.000Z" },
};

/* -------------------------------------------------------------------------- */
/* vector indexing fixtures                                                    */
/* -------------------------------------------------------------------------- */

export const GMAIL_STORE_DOCUMENT: VectorStoreDocument = {
  id: 41,
  user_id: OWNER_USER_ID,
  document_id: "gmail_18f0aa11bb22cc33",
  source: "gmail",
  type: "email",
  title: "Quarterly roadmap review",
  timestamp: "2026-08-01T10:00:00.000Z",
  author: "Anand Rao <anand@example.com>",
  metadata: {
    gmail: {
      messageId: "18f0aa11bb22cc33",
      threadId: "18f0aa11bb22cc00",
      subject: "Quarterly roadmap review",
      from: "Anand Rao <anand@example.com>",
    },
  },
};

export const CALENDAR_STORE_DOCUMENT: VectorStoreDocument = {
  id: 42,
  user_id: OWNER_USER_ID,
  document_id: "calendar_evt_9001",
  source: "calendar",
  type: "event",
  title: "Design sync",
  timestamp: "2026-08-01T10:00:00.000Z",
  author: "priya@example.com",
  metadata: {
    calendar: {
      event_id: "evt_9001",
      summary: "Design sync",
      location: "Meet",
      organizer: { email: "priya@example.com", displayName: "Priya Menon" },
    },
  },
};

export const EMBEDDED_CHUNK: EmbeddedChunk = {
  content: "Please send roadmap review comments by Friday.",
  chunk_index: 0,
  source_type: "gmail",
  embedding: [0.1, 0.2, 0.3],
  occurred_at: "2026-08-01T10:00:00.000Z",
};
