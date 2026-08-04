/**
 * FND-06 — the invariants the baseline suite refuses to lose.
 *
 * These helpers exist as a separate module for one reason: the FND-06
 * acceptance criterion is not "the tests pass", it is "the tests FAIL when user
 * filtering or source metadata is deliberately removed". Expressing each
 * invariant once, here, lets the baseline tests assert it against the real
 * implementation and lets mutationGuards.baseline.test.ts assert the *same*
 * function throws when handed a deliberately broken value.
 *
 * Every helper throws an AssertionError on violation — never returns a boolean.
 */

import assert from "node:assert/strict";

import type { VectorSearchResult } from "../../src/RAG/vectorStores/vectorStore.js";
import type { VectorRecord } from "../../src/RAG/vectorStores/vectorRecordMapper.js";
import type {
  RecordedKeywordSearch,
  RecordedQuery,
  RecordedSave,
  RecordedVectorSearch,
} from "../fixtures/fnd06-baseline-fixtures.js";

/* -------------------------------------------------------------------------- */
/* user filtering                                                              */
/* -------------------------------------------------------------------------- */

/** The vector store must be called at least once, always with the caller's id. */
export function assertVectorSearchUserScoped(
  calls: RecordedVectorSearch[],
  userId: string | number,
): void {
  assert.ok(
    calls.length > 0,
    "expected at least one vector search; user scoping cannot be proven otherwise",
  );

  for (const call of calls) {
    assert.equal(
      String(call.userId),
      String(userId),
      `vector search ran for user ${String(call.userId)} instead of ${String(userId)}`,
    );
  }
}

/** The BM25 side of hybrid retrieval must carry the same identity. */
export function assertKeywordSearchUserScoped(
  calls: RecordedKeywordSearch[],
  userId: string | number,
): void {
  assert.ok(
    calls.length > 0,
    "expected at least one keyword search; user scoping cannot be proven otherwise",
  );

  for (const call of calls) {
    assert.equal(
      String(call.userId),
      String(userId),
      `keyword search ran for user ${String(call.userId)} instead of ${String(userId)}`,
    );
  }
}

/** No row that reaches the answer may belong to another account. */
export function assertResultsBelongToUser(
  results: VectorSearchResult[],
  userId: string | number,
): void {
  assert.ok(results.length > 0, "expected retrieved results to assert ownership on");

  for (const result of results) {
    const owner = result.document?.metadata?.user_id;
    assert.ok(
      owner !== undefined && owner !== null,
      `retrieved chunk ${String(result.chunk_id)} carries no user_id in its metadata`,
    );
    assert.equal(
      String(owner),
      String(userId),
      `retrieved chunk ${String(result.chunk_id)} belongs to user ${String(owner)}, not ${String(userId)}`,
    );
  }
}

/** Persisted turns are written under the authenticated identity, never the body's. */
export function assertConversationSaveUserScoped(
  save: RecordedSave | undefined,
  userId: string | number,
  conversationId: string,
): void {
  assert.ok(save, "expected the turn to be persisted");
  assert.equal(
    String(save.userId),
    String(userId),
    `conversation saved under user ${String(save.userId)} instead of ${String(userId)}`,
  );
  assert.equal(save.conversationId, conversationId);
}

/** Every conversation statement filters on user_id and passes the id as a parameter. */
export function assertSqlUserScoped(
  query: RecordedQuery | undefined,
  userId: string | number,
): void {
  assert.ok(query, "expected a SQL statement to inspect");
  assert.match(
    query.sql,
    /user_id\s*=\s*\$\d/,
    "SQL statement does not filter on user_id",
  );
  assert.ok(
    query.params.some((param) => String(param) === String(userId)),
    `SQL parameters ${JSON.stringify(query.params)} do not include user ${String(userId)}`,
  );
}

/** A Chroma filter must always narrow by user_id, at any nesting depth. */
export function assertWhereClauseUserScoped(
  where: unknown,
  userId: string | number,
): void {
  assert.ok(
    whereContainsUserFilter(where, String(userId)),
    `Chroma where clause ${JSON.stringify(where)} does not filter user_id = ${String(userId)}`,
  );
}

function whereContainsUserFilter(where: unknown, userId: string): boolean {
  if (!where || typeof where !== "object") return false;

  if (Array.isArray(where)) {
    return where.some((entry) => whereContainsUserFilter(entry, userId));
  }

  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (key === "user_id" && String(value) === userId) return true;
    if (whereContainsUserFilter(value, userId)) return true;
  }

  return false;
}

/* -------------------------------------------------------------------------- */
/* source metadata                                                             */
/* -------------------------------------------------------------------------- */

const SOURCE_IDENTITY_KEYS: Record<string, string[]> = {
  gmail: ["sender_email", "sender_name_norm", "from", "subject", "title_norm"],
  calendar: [
    "organizer_email",
    "organizer_name_norm",
    "organizer",
    "summary",
    "title_norm",
  ],
};

/**
 * Retrieved chunks must keep the provenance the citation layer and the context
 * builder read: a source_type, a document reference, and the nested metadata
 * carrying who/what the item was.
 */
export function assertSourceMetadataPreserved(
  results: VectorSearchResult[],
): void {
  assert.ok(results.length > 0, "expected results to assert source metadata on");

  for (const result of results) {
    assert.ok(
      typeof result.source_type === "string" && result.source_type.length > 0,
      `chunk ${String(result.chunk_id)} lost its source_type`,
    );
    assert.ok(
      result.document && result.document.id !== undefined &&
        result.document.id !== null,
      `chunk ${String(result.chunk_id)} lost its document reference`,
    );

    const metadata = result.document?.metadata;
    assert.ok(
      metadata && typeof metadata === "object",
      `chunk ${String(result.chunk_id)} lost its document metadata`,
    );

    const identityKeys = SOURCE_IDENTITY_KEYS[result.source_type] ?? [];
    if (identityKeys.length > 0) {
      assert.ok(
        identityKeys.some((key) => metadata[key] !== undefined && metadata[key] !== null),
        `chunk ${String(result.chunk_id)} carries ${result.source_type} metadata with none of ${identityKeys.join(", ")}`,
      );
    }
  }
}

/** Normalizer output keeps the provider identity the retrieval planner resolves against. */
export function assertNormalizedSourceMetadata(
  document: Record<string, unknown> | null,
  source: "gmail" | "calendar",
): void {
  assert.ok(document, "expected a normalized document");
  assert.equal(document.source, source, "normalized document lost its source");

  const metadata = document.metadata as Record<string, unknown> | undefined;
  assert.ok(
    metadata && typeof metadata === "object",
    "normalized document lost its metadata",
  );

  const nested = metadata[source] as Record<string, unknown> | undefined;
  assert.ok(
    nested && typeof nested === "object",
    `normalized document lost its metadata.${source} block`,
  );

  const requiredKeys = source === "gmail"
    ? ["messageId", "threadId", "subject", "from"]
    : ["event_id", "summary", "start_time", "end_time"];

  for (const key of requiredKeys) {
    assert.ok(
      key in nested,
      `normalized ${source} document is missing metadata.${source}.${key}`,
    );
  }
}

/** Normalizer output is stamped with the syncing user, not left ownerless. */
export function assertNormalizedDocumentUserScoped(
  document: Record<string, unknown> | null,
  userId: string | number,
): void {
  assert.ok(document, "expected a normalized document");
  assert.equal(
    String(document.userId),
    String(userId),
    `normalized document belongs to ${String(document.userId)} instead of ${String(userId)}`,
  );
}

/* -------------------------------------------------------------------------- */
/* vector index records                                                        */
/* -------------------------------------------------------------------------- */

/** Chroma rows are self-describing: the id and the metadata both name the owner. */
export function assertVectorRecordUserScoped(
  record: VectorRecord,
  userId: string | number,
): void {
  assert.equal(
    String(record.metadata.user_id),
    String(userId),
    `vector record ${record.id} carries user_id ${String(record.metadata.user_id)}`,
  );
  assert.ok(
    record.id.startsWith(`u:${String(userId)}:`),
    `vector record id ${record.id} is not namespaced by user ${String(userId)}`,
  );
}

/** Chroma rows keep the normalized identity fields person resolution matches on. */
export function assertVectorRecordSourceMetadata(
  record: VectorRecord,
  source: "gmail" | "calendar",
): void {
  assert.equal(record.metadata.source, source, "vector record lost its source");
  assert.equal(
    record.metadata.schema_version,
    "v1",
    "vector record lost its schema_version",
  );

  const identityKey = source === "gmail" ? "sender_email" : "organizer_email";
  assert.ok(
    record.metadata[identityKey] !== undefined,
    `vector record lost ${identityKey}; person resolution cannot match this row`,
  );
  assert.ok(
    record.metadata.title_norm !== undefined,
    "vector record lost title_norm",
  );
}
