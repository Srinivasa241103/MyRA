/**
 * FND-06 — mutation guards.
 *
 * The package's acceptance criterion is not "the baseline passes", it is:
 *
 *     Tests fail when user filtering or source metadata is deliberately removed.
 *
 * A safety net nobody has ever seen catch anything is indistinguishable from no
 * net at all. This file deliberately breaks each protected invariant — dropping
 * a user predicate, returning another account's row, stripping the source
 * metadata block — and asserts that the *same* assertion helper the baseline
 * suite uses rejects the mutant.
 *
 * Each section opens with a control: the unmutated value must pass, so a helper
 * that always throws cannot masquerade as a working guard.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import Retriever from "../../src/RAG/retrieval/retriever.js";
import { HybridSearchExecutor } from "../../src/RAG/retrieval/hybridSearchExecutor.js";
import { GmailNormalizer } from "../../src/service/normalizers/GmailNormalizer.js";
import { GoogleCalendarNormalizer } from "../../src/service/normalizers/GoogleCalendarNormalizer.js";
import { mapEmbeddedChunkToVectorRecord } from "../../src/RAG/vectorStores/vectorRecordMapper.js";
import type VectorStore from "../../src/RAG/vectorStores/vectorStore.js";
import type {
  VectorSearchParams,
  VectorSearchResult,
} from "../../src/RAG/vectorStores/vectorStore.js";
import type { KeywordSearchRepository } from "../../src/database/keywordSearchRepository.js";
import type { Reranker } from "../../src/RAG/retrieval/reranker.js";

import {
  CALENDAR_TIMED_EVENT,
  EMBEDDED_CHUNK,
  GMAIL_PLAIN_MESSAGE,
  GMAIL_STORE_DOCUMENT,
  INTRUDER_USER_ID,
  OWNER_USER_ID,
  PassThroughReranker,
  RecordingKeywordRepository,
  StubEmbedding,
  StubPersonResolver,
  intruderVectorResult,
  keywordResult,
  rankedResult,
  resolvePersonAs,
  vectorResult,
} from "../fixtures/fnd06-baseline-fixtures.js";
import {
  assertConversationSaveUserScoped,
  assertKeywordSearchUserScoped,
  assertNormalizedDocumentUserScoped,
  assertNormalizedSourceMetadata,
  assertResultsBelongToUser,
  assertSourceMetadataPreserved,
  assertSqlUserScoped,
  assertVectorRecordSourceMetadata,
  assertVectorRecordUserScoped,
  assertVectorSearchUserScoped,
  assertWhereClauseUserScoped,
} from "./baselineAssertions.js";

const ASSERTION_FAILED = { name: "AssertionError" };

/* -------------------------------------------------------------------------- */
/* controls                                                                    */
/* -------------------------------------------------------------------------- */

test("control: the unmutated values pass every guard", () => {
  const results = [rankedResult({ documentPk: 1, sourceType: "gmail" })];
  const record = mapEmbeddedChunkToVectorRecord(GMAIL_STORE_DOCUMENT, EMBEDDED_CHUNK);
  const email = new GmailNormalizer().normalize(GMAIL_PLAIN_MESSAGE, OWNER_USER_ID);

  assert.doesNotThrow(() => assertResultsBelongToUser(results, OWNER_USER_ID));
  assert.doesNotThrow(() => assertSourceMetadataPreserved(results));
  assert.doesNotThrow(() => assertVectorRecordUserScoped(record, OWNER_USER_ID));
  assert.doesNotThrow(() => assertVectorRecordSourceMetadata(record, "gmail"));
  assert.doesNotThrow(() => assertNormalizedDocumentUserScoped(email, OWNER_USER_ID));
  assert.doesNotThrow(() => assertNormalizedSourceMetadata(email, "gmail"));
  assert.doesNotThrow(() =>
    assertWhereClauseUserScoped(
      { $and: [{ user_id: String(OWNER_USER_ID) }, { source: "gmail" }] },
      OWNER_USER_ID,
    )
  );
  assert.doesNotThrow(() =>
    assertSqlUserScoped(
      { sql: "SELECT 1 FROM conversations WHERE user_id = $1", params: [OWNER_USER_ID] },
      OWNER_USER_ID,
    )
  );
});

/* -------------------------------------------------------------------------- */
/* mutation 1 — user filtering removed from retrieval                          */
/* -------------------------------------------------------------------------- */

/** A store that ignores the caller's identity — the classic multi-tenant leak. */
class LeakyVectorStore {
  readonly calls: Array<{ userId: string | number }> = [];

  constructor(private readonly rows: VectorSearchResult[]) {}

  async search(params: VectorSearchParams): Promise<VectorSearchResult[]> {
    this.calls.push({ userId: params.userId });
    return this.rows; // the user filter is gone
  }
}

test("removing the user filter from the vector store fails the baseline", async () => {
  const leakyStore = new LeakyVectorStore([vectorResult(), intruderVectorResult()]);
  const keywordRepository = new RecordingKeywordRepository([keywordResult()]);

  const retriever = new Retriever({
    vectorStore: leakyStore as unknown as VectorStore,
    embedder: new StubEmbedding() as unknown as never,
    reranker: new PassThroughReranker() as unknown as Reranker,
    personResolver: new StubPersonResolver(resolvePersonAs.resolved),
    hybridSearchExecutor: new HybridSearchExecutor({
      vectorStore: leakyStore,
      keywordRepository: keywordRepository as unknown as KeywordSearchRepository,
    }),
  });

  const outcome = await retriever.retrieveWithDiagnostics("roadmap review", OWNER_USER_ID, {
    enableRerank: false,
  });

  // The leak is invisible to a shape-only check: the request still succeeds and
  // still returns well-formed chunks. Only the ownership assertion catches it.
  assert.ok(outcome.chunks.length > 1);
  assert.throws(
    () => assertResultsBelongToUser(outcome.chunks, OWNER_USER_ID),
    ASSERTION_FAILED,
    "another account's chunk survived retrieval without failing the baseline",
  );
});

test("passing the wrong identity to the vector store fails the baseline", () => {
  assert.throws(
    () =>
      assertVectorSearchUserScoped(
        [{ userId: INTRUDER_USER_ID, topK: 10, filters: undefined, queryEmbedding: [0.1] }],
        OWNER_USER_ID,
      ),
    ASSERTION_FAILED,
  );
});

test("skipping the vector search entirely fails the baseline", () => {
  assert.throws(
    () => assertVectorSearchUserScoped([], OWNER_USER_ID),
    ASSERTION_FAILED,
    "an assertion that never ran must not count as a pass",
  );
});

test("dropping the user id from the keyword leg fails the baseline", () => {
  assert.throws(
    () =>
      assertKeywordSearchUserScoped(
        [
          {
            query: "roadmap",
            userId: "",
            topK: 20,
            filters: undefined,
            sort: "relevance",
            requireKeywordMatch: true,
          },
        ],
        OWNER_USER_ID,
      ),
    ASSERTION_FAILED,
  );
});

test("a retrieved chunk with no owner recorded fails the baseline", () => {
  const orphan = vectorResult({ metadata: { source: "gmail", document_pk: 1 } });

  assert.throws(
    () => assertResultsBelongToUser([orphan], OWNER_USER_ID),
    ASSERTION_FAILED,
  );
});

/* -------------------------------------------------------------------------- */
/* mutation 2 — user filtering removed from persistence                        */
/* -------------------------------------------------------------------------- */

test("a conversation query without a user predicate fails the baseline", () => {
  assert.throws(
    () =>
      assertSqlUserScoped(
        {
          sql: "SELECT user_message FROM conversations WHERE conversation_id = $1",
          params: ["conversation-fnd06"],
        },
        OWNER_USER_ID,
      ),
    ASSERTION_FAILED,
  );
});

test("a user predicate that never receives the caller's id fails the baseline", () => {
  assert.throws(
    () =>
      assertSqlUserScoped(
        {
          sql: "SELECT user_message FROM conversations WHERE user_id = $1",
          params: [INTRUDER_USER_ID],
        },
        OWNER_USER_ID,
      ),
    ASSERTION_FAILED,
  );
});

test("persisting a turn under the wrong user fails the baseline", () => {
  assert.throws(
    () =>
      assertConversationSaveUserScoped(
        {
          userId: INTRUDER_USER_ID,
          conversationId: "conversation-fnd06",
          userMessage: "roadmap",
          assistantMessage: "answer",
          metadata: {},
        },
        OWNER_USER_ID,
        "conversation-fnd06",
      ),
    ASSERTION_FAILED,
  );
});

/* -------------------------------------------------------------------------- */
/* mutation 3 — user filtering removed from the vector index                   */
/* -------------------------------------------------------------------------- */

test("a Chroma filter without the user predicate fails the baseline", () => {
  assert.throws(
    () =>
      assertWhereClauseUserScoped(
        { $and: [{ schema_version: "v1" }, { source: "gmail" }] },
        OWNER_USER_ID,
      ),
    ASSERTION_FAILED,
    "a Chroma query with no tenant predicate reads the whole collection",
  );
});

test("a Chroma filter naming another user fails the baseline", () => {
  assert.throws(
    () =>
      assertWhereClauseUserScoped(
        { $and: [{ user_id: String(INTRUDER_USER_ID) }, { schema_version: "v1" }] },
        OWNER_USER_ID,
      ),
    ASSERTION_FAILED,
  );
});

test("a vector record written without user_id fails the baseline", () => {
  const record = mapEmbeddedChunkToVectorRecord(GMAIL_STORE_DOCUMENT, EMBEDDED_CHUNK);
  const { user_id: _dropped, ...metadataWithoutOwner } = record.metadata;

  assert.throws(
    () =>
      assertVectorRecordUserScoped(
        { ...record, metadata: metadataWithoutOwner },
        OWNER_USER_ID,
      ),
    ASSERTION_FAILED,
  );
});

test("a vector record id that is not namespaced by user fails the baseline", () => {
  const record = mapEmbeddedChunkToVectorRecord(GMAIL_STORE_DOCUMENT, EMBEDDED_CHUNK);

  assert.throws(
    () => assertVectorRecordUserScoped({ ...record, id: "d:41:c:0:v1" }, OWNER_USER_ID),
    ASSERTION_FAILED,
  );
});

/* -------------------------------------------------------------------------- */
/* mutation 4 — source metadata removed from retrieval                         */
/* -------------------------------------------------------------------------- */

test("stripping document metadata from retrieved chunks fails the baseline", () => {
  const stripped = [rankedResult({ documentPk: 1, metadata: null })];

  assert.throws(
    () => assertSourceMetadataPreserved(stripped),
    ASSERTION_FAILED,
    "a chunk with no metadata cannot be cited and must not pass",
  );
});

test("blanking source_type on retrieved chunks fails the baseline", () => {
  const blanked = [{ ...rankedResult({ documentPk: 1 }), source_type: "" }];

  assert.throws(() => assertSourceMetadataPreserved(blanked), ASSERTION_FAILED);
});

test("keeping metadata but dropping the sender identity fails the baseline", () => {
  // The shape survives — only the fields person resolution matches on are gone.
  const anonymized = [
    rankedResult({
      documentPk: 1,
      sourceType: "gmail",
      metadata: {
        user_id: String(OWNER_USER_ID),
        source: "gmail",
        document_pk: 1,
        schema_version: "v1",
      },
    }),
  ];

  assert.throws(() => assertSourceMetadataPreserved(anonymized), ASSERTION_FAILED);
});

test("dropping the organizer identity from calendar chunks fails the baseline", () => {
  const anonymized = [
    rankedResult({
      documentPk: 2,
      sourceType: "calendar",
      metadata: {
        user_id: String(OWNER_USER_ID),
        source: "calendar",
        document_pk: 2,
        schema_version: "v1",
      },
    }),
  ];

  assert.throws(() => assertSourceMetadataPreserved(anonymized), ASSERTION_FAILED);
});

/* -------------------------------------------------------------------------- */
/* mutation 5 — source metadata removed at the sync boundary                   */
/* -------------------------------------------------------------------------- */

test("a normalized email without its gmail metadata block fails the baseline", () => {
  const document = new GmailNormalizer().normalize(GMAIL_PLAIN_MESSAGE, OWNER_USER_ID);
  const mutated = { ...document, metadata: {} };

  assert.throws(() => assertNormalizedSourceMetadata(mutated, "gmail"), ASSERTION_FAILED);
});

test("a normalized email missing its thread and subject fails the baseline", () => {
  const document = new GmailNormalizer().normalize(GMAIL_PLAIN_MESSAGE, OWNER_USER_ID);
  const mutated = {
    ...document,
    metadata: { gmail: { messageId: document.metadata.gmail.messageId } },
  };

  assert.throws(() => assertNormalizedSourceMetadata(mutated, "gmail"), ASSERTION_FAILED);
});

test("a normalized event missing its event id fails the baseline", () => {
  const document = new GoogleCalendarNormalizer().normalize(
    CALENDAR_TIMED_EVENT,
    OWNER_USER_ID,
  );
  const { event_id: _dropped, ...calendarWithoutId } = document.metadata.calendar;
  const mutated = { ...document, metadata: { calendar: calendarWithoutId } };

  assert.throws(() => assertNormalizedSourceMetadata(mutated, "calendar"), ASSERTION_FAILED);
});

test("a normalized document with no owner fails the baseline", () => {
  const document = new GmailNormalizer().normalize(GMAIL_PLAIN_MESSAGE, OWNER_USER_ID);

  assert.throws(
    () => assertNormalizedDocumentUserScoped({ ...document, userId: undefined }, OWNER_USER_ID),
    ASSERTION_FAILED,
  );
  assert.throws(
    () =>
      assertNormalizedDocumentUserScoped(
        { ...document, userId: INTRUDER_USER_ID },
        OWNER_USER_ID,
      ),
    ASSERTION_FAILED,
  );
});

/* -------------------------------------------------------------------------- */
/* mutation 6 — source metadata removed from the vector index                  */
/* -------------------------------------------------------------------------- */

test("a vector record without the sender identity fails the baseline", () => {
  const record = mapEmbeddedChunkToVectorRecord(GMAIL_STORE_DOCUMENT, EMBEDDED_CHUNK);
  const { sender_email: _dropped, ...metadata } = record.metadata;

  assert.throws(
    () => assertVectorRecordSourceMetadata({ ...record, metadata }, "gmail"),
    ASSERTION_FAILED,
  );
});

test("a vector record without title_norm fails the baseline", () => {
  const record = mapEmbeddedChunkToVectorRecord(GMAIL_STORE_DOCUMENT, EMBEDDED_CHUNK);
  const { title_norm: _dropped, ...metadata } = record.metadata;

  assert.throws(
    () => assertVectorRecordSourceMetadata({ ...record, metadata }, "gmail"),
    ASSERTION_FAILED,
  );
});

test("a vector record written without a schema version fails the baseline", () => {
  const record = mapEmbeddedChunkToVectorRecord(GMAIL_STORE_DOCUMENT, EMBEDDED_CHUNK);
  const { schema_version: _dropped, ...metadata } = record.metadata;

  assert.throws(
    () => assertVectorRecordSourceMetadata({ ...record, metadata }, "gmail"),
    ASSERTION_FAILED,
    "Chroma reads filter on schema_version; a record without one is unreachable",
  );
});
