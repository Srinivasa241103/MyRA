/**
 * FND-06 — vector indexing and Chroma read-path baseline.
 *
 * Chroma has no row-level security: the only thing separating two users is the
 * `user_id` written into every record's metadata and the `user_id` predicate
 * put on every query. Both halves are asserted here, along with the normalized
 * identity fields (`sender_email`, `organizer_email`, `title_norm`) that person
 * resolution matches against — losing them degrades retrieval to plain
 * semantic search without any visible failure.
 *
 * The store is exercised against an injected collection, so no Chroma server,
 * PostgreSQL, or embedding provider is required.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  buildVectorDocumentText,
  buildVectorMetadata,
  buildVectorRecordId,
  mapDocumentChunksToVectorRecords,
  mapEmbeddedChunkToVectorRecord,
} from "../../src/RAG/vectorStores/vectorRecordMapper.js";
import { chunkDocument } from "../../src/RAG/ingestion/chunker.js";

import {
  CALENDAR_STORE_DOCUMENT,
  EMBEDDED_CHUNK,
  GMAIL_STORE_DOCUMENT,
  INTRUDER_USER_ID,
  OWNER_USER_ID,
} from "../fixtures/fnd06-baseline-fixtures.js";
import {
  assertVectorRecordSourceMetadata,
  assertVectorRecordUserScoped,
  assertWhereClauseUserScoped,
} from "./baselineAssertions.js";

/* -------------------------------------------------------------------------- */
/* write path — record mapping                                                 */
/* -------------------------------------------------------------------------- */

test("a Gmail chunk maps to a user-namespaced, source-tagged record", () => {
  const record = mapEmbeddedChunkToVectorRecord(GMAIL_STORE_DOCUMENT, EMBEDDED_CHUNK);

  assertVectorRecordUserScoped(record, OWNER_USER_ID);
  assertVectorRecordSourceMetadata(record, "gmail");

  assert.equal(record.id, `u:${OWNER_USER_ID}:d:41:c:0:v1`);
  assert.equal(record.metadata.document_pk, 41);
  assert.equal(record.metadata.document_id, "gmail_18f0aa11bb22cc33");
  assert.equal(record.metadata.type, "email");
  assert.equal(record.metadata.chunk_index, 0);
  assert.equal(record.metadata.sender_email, "anand@example.com");
  assert.equal(record.metadata.sender_name_norm, "anand rao");
  assert.equal(record.metadata.title_norm, "quarterly roadmap review");
  assert.equal(record.metadata.thread_id, "18f0aa11bb22cc00");
  assert.deepEqual(record.embedding, EMBEDDED_CHUNK.embedding);
});

test("a calendar chunk carries the organizer identity resolution matches on", () => {
  const record = mapEmbeddedChunkToVectorRecord(CALENDAR_STORE_DOCUMENT, {
    ...EMBEDDED_CHUNK,
    source_type: "calendar",
  });

  assertVectorRecordUserScoped(record, OWNER_USER_ID);
  assertVectorRecordSourceMetadata(record, "calendar");

  assert.equal(record.metadata.event_id, "evt_9001");
  assert.equal(record.metadata.organizer_email, "priya@example.com");
  assert.equal(record.metadata.organizer_name_norm, "priya menon");
  assert.equal(record.metadata.location_norm, "meet");
});

test("occurrence timestamps are indexed in both filterable forms", () => {
  const metadata = buildVectorMetadata(GMAIL_STORE_DOCUMENT, EMBEDDED_CHUNK);

  assert.equal(metadata.occurred_at_ms, Date.parse("2026-08-01T10:00:00.000Z"));
  assert.equal(metadata.date_yyyy_mm_dd, "2026-08-01");
  assert.equal(metadata.schema_version, "v1");
});

test("a chunk without its own timestamp falls back to the document timestamp", () => {
  const metadata = buildVectorMetadata(GMAIL_STORE_DOCUMENT, {
    ...EMBEDDED_CHUNK,
    occurred_at: null,
  });

  assert.equal(metadata.occurred_at_ms, Date.parse("2026-08-01T10:00:00.000Z"));
});

test("record ids are unique per user, document, and chunk", () => {
  const other = buildVectorRecordId(
    { ...GMAIL_STORE_DOCUMENT, user_id: INTRUDER_USER_ID },
    EMBEDDED_CHUNK,
  );

  assert.notEqual(buildVectorRecordId(GMAIL_STORE_DOCUMENT, EMBEDDED_CHUNK), other);
  assert.notEqual(
    buildVectorRecordId(GMAIL_STORE_DOCUMENT, EMBEDDED_CHUNK),
    buildVectorRecordId(GMAIL_STORE_DOCUMENT, { ...EMBEDDED_CHUNK, chunk_index: 1 }),
  );
});

test("the embedded document text carries a readable provenance envelope", () => {
  const text = buildVectorDocumentText(GMAIL_STORE_DOCUMENT, EMBEDDED_CHUNK);

  assert.match(text, /^Source: gmail\n/);
  assert.match(text, /Type: email/);
  assert.match(text, /Title: Quarterly roadmap review/);
  assert.match(text, /Author: Anand Rao <anand@example\.com>/);
  assert.match(text, /Date: 2026-08-01T10:00:00\.000Z/);
  assert.ok(text.endsWith(EMBEDDED_CHUNK.content));
});

test("every chunk of a document inherits the same ownership", () => {
  const records = mapDocumentChunksToVectorRecords(GMAIL_STORE_DOCUMENT, [
    EMBEDDED_CHUNK,
    { ...EMBEDDED_CHUNK, chunk_index: 1, content: "second chunk" },
  ]);

  assert.equal(records.length, 2);
  for (const record of records) {
    assertVectorRecordUserScoped(record, OWNER_USER_ID);
    assertVectorRecordSourceMetadata(record, "gmail");
  }
});

/* -------------------------------------------------------------------------- */
/* ingestion — chunking                                                        */
/* -------------------------------------------------------------------------- */

test("chunking preserves order and stamps the source type", async () => {
  const chunks = await chunkDocument({
    content: Array.from({ length: 400 }, (_, index) => `sentence ${index}.`).join(" "),
    source: "gmail",
  });

  assert.ok(chunks.length > 1, "a long document was not split");
  assert.deepEqual(
    chunks.map((chunk: { chunk_index: number }) => chunk.chunk_index),
    chunks.map((_: unknown, index: number) => index),
  );
  assert.ok(chunks.every((chunk: { source_type: string }) => chunk.source_type === "gmail"));
});

test("an empty document produces no chunks", async () => {
  assert.deepEqual(await chunkDocument({ content: "", source: "gmail" }), []);
});

/* -------------------------------------------------------------------------- */
/* read path — Chroma filtering                                                */
/* -------------------------------------------------------------------------- */

interface RecordedQuery {
  where: unknown;
  nResults: number;
}

class FakeCollection {
  readonly queries: RecordedQuery[] = [];

  constructor(
    private readonly rows: Array<{
      id: string;
      document: string;
      metadata: Record<string, unknown>;
      distance: number;
    }> = [],
  ) {}

  async query(params: { where: unknown; nResults: number }) {
    this.queries.push({ where: params.where, nResults: params.nResults });

    return {
      ids: [this.rows.map((row) => row.id)],
      documents: [this.rows.map((row) => row.document)],
      metadatas: [this.rows.map((row) => row.metadata)],
      distances: [this.rows.map((row) => row.distance)],
    };
  }
}

const OWNED_ROW = {
  id: `u:${OWNER_USER_ID}:d:41:c:0:v1`,
  document: "Please send roadmap review comments by Friday.",
  distance: 0.12,
  metadata: {
    user_id: String(OWNER_USER_ID),
    document_pk: 41,
    document_id: "gmail_18f0aa11bb22cc33",
    source: "gmail",
    chunk_index: 0,
    schema_version: "v1",
    occurred_at_ms: Date.parse("2026-08-01T10:00:00.000Z"),
    sender_email: "anand@example.com",
    title_norm: "quarterly roadmap review",
  },
};

const savedChromaEnv = {
  apiKey: process.env.CHROMA_API_KEY,
  host: process.env.CHROMA_HOST,
  port: process.env.CHROMA_PORT,
};

before(() => {
  // Pin the local (non-cloud) client so the suite never depends on whichever
  // Chroma deployment the developer happens to have configured.
  delete process.env.CHROMA_API_KEY;
  process.env.CHROMA_HOST = "localhost";
  process.env.CHROMA_PORT = "8000";
});

after(() => {
  if (savedChromaEnv.apiKey === undefined) delete process.env.CHROMA_API_KEY;
  else process.env.CHROMA_API_KEY = savedChromaEnv.apiKey;
  if (savedChromaEnv.host === undefined) delete process.env.CHROMA_HOST;
  else process.env.CHROMA_HOST = savedChromaEnv.host;
  if (savedChromaEnv.port === undefined) delete process.env.CHROMA_PORT;
  else process.env.CHROMA_PORT = savedChromaEnv.port;
});

async function buildStore(
  rows = [OWNED_ROW],
  readyDocumentIds: string[] = ["41"],
) {
  const { default: ChromaVectorStore } = await import(
    "../../src/RAG/vectorStores/chromaVectorStore.js"
  );
  const collection = new FakeCollection(rows);
  const indexLookups: Array<{ userId: string | number; documentIds: unknown[] }> = [];

  const store = new ChromaVectorStore({
    findReadyDocumentIds: async (
      params: { userId: string | number; documentIds: unknown[] },
    ) => {
      indexLookups.push(params);
      return new Set(readyDocumentIds);
    },
  } as never);

  // getCollection() is private and would otherwise reach a live server.
  (store as unknown as { getCollection: () => Promise<unknown> }).getCollection =
    async () => collection;

  return { store, collection, indexLookups };
}

test("every Chroma search filters by user, schema version, and source", async () => {
  const { store, collection } = await buildStore();

  await store.search({
    queryEmbedding: [0.1, 0.2, 0.3],
    userId: OWNER_USER_ID,
    topK: 7,
    filters: { sourceType: "gmail" },
  });

  const [query] = collection.queries;
  assertWhereClauseUserScoped(query.where, OWNER_USER_ID);
  assert.equal(query.nResults, 7);
  assert.deepEqual(query.where, {
    $and: [
      { user_id: String(OWNER_USER_ID) },
      { schema_version: "v1" },
      { source: "gmail" },
    ],
  });
});

test("an unfiltered search is still user scoped", async () => {
  const { store, collection } = await buildStore();

  await store.search({ queryEmbedding: [0.1], userId: OWNER_USER_ID });

  assertWhereClauseUserScoped(collection.queries[0]?.where, OWNER_USER_ID);
});

test("date and metadata filters are appended to the user predicate", async () => {
  const { store, collection } = await buildStore();

  await store.search({
    queryEmbedding: [0.1],
    userId: OWNER_USER_ID,
    filters: {
      occurredAfter: "2026-07-01T00:00:00.000Z",
      occurredBefore: "2026-08-31T00:00:00.000Z",
      metadata: { sender_email: "anand@example.com" },
    },
  });

  const where = collection.queries[0]?.where as { $and: Array<Record<string, unknown>> };
  assertWhereClauseUserScoped(where, OWNER_USER_ID);
  assert.deepEqual(where.$and[2], {
    occurred_at_ms: { $gte: Date.parse("2026-07-01T00:00:00.000Z") },
  });
  assert.deepEqual(where.$and[3], {
    occurred_at_ms: { $lte: Date.parse("2026-08-31T00:00:00.000Z") },
  });
  assert.deepEqual(where.$and[4], { sender_email: "anand@example.com" });
});

test("search results are rehydrated with their source metadata", async () => {
  const { store } = await buildStore();

  const [result] = await store.search({
    queryEmbedding: [0.1],
    userId: OWNER_USER_ID,
  });

  assert.equal(result.chunk_id, OWNED_ROW.id);
  assert.equal(result.source_type, "gmail");
  assert.equal(result.chunk_index, 0);
  assert.equal(result.distance, 0.12);
  assert.equal(result.document.id, 41);
  assert.equal(result.document.source_id, "gmail_18f0aa11bb22cc33");
  assert.equal(result.document.author, "anand@example.com");
  assert.equal(result.document.metadata?.user_id, String(OWNER_USER_ID));
  assert.deepEqual(result.occurred_at, new Date("2026-08-01T10:00:00.000Z"));
});

test("chunks whose document is not index-ready are dropped, scoped to the user", async () => {
  const { store, indexLookups } = await buildStore([OWNED_ROW], []);

  const results = await store.search({
    queryEmbedding: [0.1],
    userId: OWNER_USER_ID,
  });

  assert.deepEqual(results, [], "a chunk was returned before its document was ready");
  assert.equal(indexLookups[0]?.userId, OWNER_USER_ID);
  assert.deepEqual(indexLookups[0]?.documentIds, [41]);
});

test("an empty query embedding is rejected before any collection call", async () => {
  const { store, collection } = await buildStore();

  await assert.rejects(
    () => store.search({ queryEmbedding: [], userId: OWNER_USER_ID }),
    /search requires a non-empty queryEmbedding array/,
  );
  assert.equal(collection.queries.length, 0);
});

test("deleting a document's chunks is scoped to the owner", async () => {
  const { store } = await buildStore();
  const deletes: Array<{ where: unknown }> = [];

  (store as unknown as { getCollection: () => Promise<unknown> }).getCollection =
    async () => ({
      delete: async (params: { where: unknown }) => {
        deletes.push(params);
      },
    });

  await store.deleteDocumentChunks({ userId: OWNER_USER_ID, documentId: 41 });

  assertWhereClauseUserScoped(deletes[0]?.where, OWNER_USER_ID);
  assert.deepEqual(deletes[0]?.where, {
    $and: [{ user_id: String(OWNER_USER_ID) }, { document_pk: 41 }],
  });
});
