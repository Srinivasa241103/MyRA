/**
 * FND-06 — chat persistence and ownership baseline.
 *
 * FND-04 proved cross-user denial end to end against a live database. This
 * suite freezes the layer underneath it without one: every ConversationRepository
 * statement must refuse to run without an identity, must filter on `user_id`,
 * and must pass that identity as a bound parameter rather than interpolating it.
 * A repository method that silently loses its user predicate is exactly the
 * regression the agent runtime would inherit.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import ConversationRepository from "../../src/database/conversationsRepo.js";

import {
  CONVERSATION_ID,
  OWNER_USER_ID,
  RecordingDatabase,
} from "../fixtures/fnd06-baseline-fixtures.js";
import { assertSqlUserScoped } from "./baselineAssertions.js";

function buildRepository(
  result: { rows: Record<string, unknown>[]; rowCount?: number } = { rows: [] },
) {
  const db = new RecordingDatabase(result);
  const repository = new ConversationRepository(db as never);
  return { repository, db };
}

/* -------------------------------------------------------------------------- */
/* identity is mandatory                                                       */
/* -------------------------------------------------------------------------- */

test("every conversation operation refuses to run without a user id", async () => {
  const { repository, db } = buildRepository();

  const calls: Array<[string, () => Promise<unknown>]> = [
    ["getConversationHistory", () => repository.getConversationHistory(CONVERSATION_ID, undefined)],
    ["getConversationStatus", () => repository.getConversationStatus(CONVERSATION_ID, null)],
    [
      "saveChatConversation",
      () =>
        repository.saveChatConversation({
          conversation_id: CONVERSATION_ID,
          user_message: "hi",
          assistant_message: "hello",
          userId: undefined,
        }),
    ],
    ["getConversations", () => repository.getConversations(10, "  ")],
    ["clear", () => repository.clear(CONVERSATION_ID, undefined)],
  ];

  for (const [name, call] of calls) {
    await assert.rejects(
      call,
      /userId is required for conversation operations/,
      `${name} ran without a user id`,
    );
  }

  assert.equal(db.queries.length, 0, "a statement reached the database without an identity");
});

/* -------------------------------------------------------------------------- */
/* every statement is user scoped                                              */
/* -------------------------------------------------------------------------- */

test("reading history filters by conversation, user, and soft deletion", async () => {
  const { repository, db } = buildRepository({
    rows: [{ user_message: "hi", assistant_message: "hello", metadata: "{}" }],
  });

  await repository.getConversationHistory(CONVERSATION_ID, OWNER_USER_ID, 5);

  const [query] = db.queries;
  assertSqlUserScoped(query, OWNER_USER_ID);
  assert.deepEqual(query.params, [CONVERSATION_ID, OWNER_USER_ID, 5]);
  assert.match(query.sql, /is_deleted IS NULL/);
  assert.match(query.sql, /ORDER BY created_at DESC/);
  assert.match(query.sql, /ORDER BY created_at ASC/);
});

test("the conversation status query counts only the caller's rows", async () => {
  const { repository, db } = buildRepository({
    rows: [{ total_count: 3, active_count: 2 }],
  });

  const status = await repository.getConversationStatus(CONVERSATION_ID, OWNER_USER_ID);

  assertSqlUserScoped(db.queries[0], OWNER_USER_ID);
  assert.deepEqual(db.queries[0]?.params, [OWNER_USER_ID, CONVERSATION_ID]);
  assert.deepEqual(status, {
    exists: true,
    active: true,
    totalCount: 3,
    activeCount: 2,
  });
});

test("a conversation with no rows reports neither existing nor active", async () => {
  const { repository } = buildRepository({ rows: [] });

  assert.deepEqual(
    await repository.getConversationStatus(CONVERSATION_ID, OWNER_USER_ID),
    { exists: false, active: false, totalCount: 0, activeCount: 0 },
  );
});

test("a deleted conversation still exists but is no longer active", async () => {
  const { repository } = buildRepository({
    rows: [{ total_count: 4, active_count: 0 }],
  });

  assert.deepEqual(
    await repository.getConversationStatus(CONVERSATION_ID, OWNER_USER_ID),
    { exists: true, active: false, totalCount: 4, activeCount: 0 },
  );
});

test("saving a turn writes the user id and serializes the metadata", async () => {
  const { repository, db } = buildRepository();

  await repository.saveChatConversation({
    conversation_id: CONVERSATION_ID,
    user_message: "roadmap review",
    assistant_message: "Anand shared the roadmap.",
    metadata: { sourceCount: 2, streamStatus: "complete" },
    userId: OWNER_USER_ID,
  });

  const [query] = db.queries;
  assert.match(query.sql, /INSERT INTO conversations/);
  assert.match(query.sql, /user_id/);
  assert.deepEqual(query.params, [
    CONVERSATION_ID,
    "roadmap review",
    "Anand shared the roadmap.",
    JSON.stringify({ sourceCount: 2, streamStatus: "complete" }),
    OWNER_USER_ID,
  ]);
});

test("listing conversations scopes both halves of the query to one user", async () => {
  const { repository, db } = buildRepository({
    rows: [
      {
        conversation_id: CONVERSATION_ID,
        title: "roadmap review",
        started_at: "2026-08-01T10:00:00.000Z",
        last_message_at: "2026-08-01T10:05:00.000Z",
      },
    ],
  });

  await repository.getConversations(25, OWNER_USER_ID);

  const [query] = db.queries;
  assertSqlUserScoped(query, OWNER_USER_ID);
  assert.deepEqual(query.params, [25, OWNER_USER_ID]);
  assert.equal(
    (query.sql.match(/user_id = \$2/g) ?? []).length,
    2,
    "both the first-message and last-activity CTEs must filter by user",
  );
});

test("deleting is a soft delete scoped to the owner and reports the row count", async () => {
  const { repository, db } = buildRepository({ rows: [], rowCount: 3 });

  const deleted = await repository.clear(CONVERSATION_ID, OWNER_USER_ID);

  const [query] = db.queries;
  assertSqlUserScoped(query, OWNER_USER_ID);
  assert.match(query.sql, /UPDATE conversations/);
  assert.match(query.sql, /SET is_deleted = true/);
  assert.deepEqual(query.params, [OWNER_USER_ID, CONVERSATION_ID]);
  assert.equal(deleted, 3);
});

test("deleting someone else's conversation changes nothing", async () => {
  const { repository } = buildRepository({ rows: [], rowCount: 0 });

  assert.equal(await repository.clear(CONVERSATION_ID, OWNER_USER_ID), 0);
});
