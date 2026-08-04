/**
 * FND-06 — sync boundary baseline.
 *
 * Two boundaries are frozen here, both of which the connector work (CON-01…05)
 * will re-implement behind the Tool Gateway:
 *
 *   IngestionPipeline — fetch → normalize → persist accounting. Every document
 *   is looked up and written under the syncing user, a skipped normalization is
 *   counted rather than crashing the run, and an unchanged document is skipped
 *   instead of re-indexed.
 *
 *   SyncController — the HTTP edge. The sync log, the ingestion run, the
 *   embedding run, and every websocket event carry the *authenticated* user,
 *   and the sync-log source name ("google_calendar") stays distinct from the
 *   ingestion source key ("calendar"). Those two vocabularies have collided
 *   before; the mapping is asserted in both directions.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import IngestionPipeline from "../../src/RAG/ingestion/ingestionPipeline.js";
import SyncController from "../../src/api/controllers/syncController.js";
import { GmailNormalizer } from "../../src/service/normalizers/GmailNormalizer.js";
import { GoogleCalendarNormalizer } from "../../src/service/normalizers/GoogleCalendarNormalizer.js";
import { SYNC_SOURCE } from "../../src/utils/constants.js";

import {
  CALENDAR_TIMED_EVENT,
  FakeRequest,
  FakeResponse,
  GMAIL_EMPTY_MESSAGE,
  GMAIL_PLAIN_MESSAGE,
  OWNER_USER_ID,
} from "../fixtures/fnd06-baseline-fixtures.js";

/* -------------------------------------------------------------------------- */
/* ingestion doubles                                                           */
/* -------------------------------------------------------------------------- */

class StubSource {
  static lastInstance: StubSource | null = null;

  readonly fetchAllCalls: Array<Record<string, unknown>> = [];
  readonly fetchNewCalls: Date[] = [];

  constructor(readonly userId: number, private readonly items: unknown[] = []) {
    StubSource.lastInstance = this;
  }

  async fetchAll(options: Record<string, unknown> = {}) {
    this.fetchAllCalls.push(options);
    return this.items;
  }

  async fetchNew(since: Date) {
    this.fetchNewCalls.push(since);
    return this.items;
  }
}

class RecordingDocumentRepository {
  readonly lookups: Array<{ documentId: string; userId: number }> = [];
  readonly created: Array<Record<string, unknown>> = [];
  readonly updated: Array<{ documentId: string; userId: number }> = [];

  constructor(private readonly existing: Map<string, Record<string, unknown>> = new Map()) {}

  async findByDocumentId(documentId: string, userId: number) {
    this.lookups.push({ documentId, userId });
    return this.existing.get(documentId) ?? null;
  }

  async create(row: Record<string, unknown>) {
    this.created.push(row);
  }

  async updateForReindex(documentId: string, userId: number) {
    this.updated.push({ documentId, userId });
  }
}

class RecordingSyncLogRepository {
  readonly created: Array<{ source: string; userId: number }> = [];
  readonly completed: Array<{ id: number; userId: number; payload: Record<string, unknown> }> = [];
  readonly failed: Array<{ id: number; userId: number; error: string }> = [];
  readonly lastSyncLookups: Array<{ source: string; userId: number }> = [];

  constructor(private readonly lastSuccessful: { sync_completed_at: Date } | null = null) {}

  async create(source: string, userId: number) {
    this.created.push({ source, userId });
    return { id: 5150 };
  }

  async complete(id: number, userId: number, payload: Record<string, unknown>) {
    this.completed.push({ id, userId, payload });
  }

  async fail(id: number, userId: number, error: string) {
    this.failed.push({ id, userId, error });
  }

  async getLastSuccessfulSync(source: string, userId: number) {
    this.lastSyncLookups.push({ source, userId });
    return this.lastSuccessful;
  }

  async findById(id: string, userId: number) {
    return { id, userId, status: "success" };
  }

  async findBySource(source: string, userId: number, limit: number) {
    return [{ source, userId, limit }];
  }
}

function buildIngestion({
  items = [GMAIL_PLAIN_MESSAGE],
  existing = new Map<string, Record<string, unknown>>(),
  lastSuccessful = null,
  normalizer,
}: {
  items?: unknown[];
  existing?: Map<string, Record<string, unknown>>;
  lastSuccessful?: { sync_completed_at: Date } | null;
  normalizer?: new () => { normalize(raw: unknown, userId: number): unknown };
} = {}) {
  const documentRepo = new RecordingDocumentRepository(existing);
  const syncRepo = new RecordingSyncLogRepository(lastSuccessful);

  class BoundSource extends StubSource {
    constructor(userId: number) {
      super(userId, items);
    }
  }

  const pipeline = new IngestionPipeline({
    documentRepo,
    syncRepo,
    sources: {
      gmail: { source: BoundSource, normalizer: normalizer ?? GmailNormalizer },
      calendar: { source: BoundSource, normalizer: normalizer ?? GmailNormalizer },
    },
  } as never);

  return { pipeline, documentRepo, syncRepo };
}

/* -------------------------------------------------------------------------- */
/* ingestion boundary                                                          */
/* -------------------------------------------------------------------------- */

test("ingestion refuses to run without an identity or a known source", async () => {
  const { pipeline } = buildIngestion();

  await assert.rejects(
    () => pipeline.runIngestion("gmail", true, null),
    /User ID is required for ingestion/,
  );
  await assert.rejects(
    () => pipeline.runIngestion("spotify", true, OWNER_USER_ID),
    /Invalid source: spotify\. Valid sources are gmail, calendar/,
  );
});

test("a full sync fetches everything and inserts under the syncing user", async () => {
  const { pipeline, documentRepo, syncRepo } = buildIngestion();

  const response = await pipeline.runIngestion("gmail", true, OWNER_USER_ID);

  assert.deepEqual(response, { fetched: 1, inserted: 1, updated: 0, skipped: 0, failed: 0 });
  assert.equal(syncRepo.lastSyncLookups.length, 0, "a full sync must not read the sync watermark");
  assert.deepEqual(StubSource.lastInstance?.fetchAllCalls, [{ maxResults: 500 }]);

  assert.deepEqual(documentRepo.lookups, [
    { documentId: `gmail_${GMAIL_PLAIN_MESSAGE.id}`, userId: OWNER_USER_ID },
  ]);

  const [created] = documentRepo.created;
  assert.equal(created.user_id, OWNER_USER_ID);
  assert.equal(created.document_id, `gmail_${GMAIL_PLAIN_MESSAGE.id}`);
  assert.equal(created.source, "gmail");
  assert.equal(created.type, "email");
  assert.ok(
    (created.metadata as { gmail?: unknown }).gmail,
    "the source metadata block was dropped on the way to the database",
  );
});

test("an incremental Gmail sync reads its watermark under the gmail sync-log name", async () => {
  const since = new Date("2026-07-30T00:00:00.000Z");
  const { pipeline, syncRepo } = buildIngestion({
    lastSuccessful: { sync_completed_at: since },
  });

  await pipeline.runIngestion("gmail", false, OWNER_USER_ID);

  assert.deepEqual(syncRepo.lastSyncLookups, [
    { source: "gmail", userId: OWNER_USER_ID },
  ]);
  assert.deepEqual(StubSource.lastInstance?.fetchNewCalls, [since]);
});

test("an incremental calendar sync reads its watermark under google_calendar", async () => {
  const since = new Date("2026-07-30T00:00:00.000Z");
  const { pipeline, syncRepo } = buildIngestion({
    lastSuccessful: { sync_completed_at: since },
  });

  await pipeline.runIngestion("calendar", false, OWNER_USER_ID);

  assert.deepEqual(
    syncRepo.lastSyncLookups,
    [{ source: "google_calendar", userId: OWNER_USER_ID }],
    "the ingestion key and the sync-log source name must not be conflated",
  );
});

test("an incremental sync with no prior success falls back to a seven-day window", async () => {
  const { pipeline } = buildIngestion({ lastSuccessful: null });

  const before = Date.now();
  await pipeline.runIngestion("gmail", false, OWNER_USER_ID);
  const since = StubSource.lastInstance?.fetchNewCalls[0]?.getTime() ?? 0;

  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  assert.ok(since <= before - sevenDays + 1_000 && since >= before - sevenDays - 60_000);
});

test("a document the normalizer skips is counted, not crashed on", async () => {
  const { pipeline, documentRepo } = buildIngestion({
    items: [GMAIL_PLAIN_MESSAGE, GMAIL_EMPTY_MESSAGE],
  });

  const response = await pipeline.runIngestion("gmail", true, OWNER_USER_ID);

  assert.deepEqual(response, { fetched: 2, inserted: 1, updated: 0, skipped: 1, failed: 0 });
  assert.equal(documentRepo.created.length, 1);
});

test("an unchanged document is skipped instead of re-indexed", async () => {
  const gmail = new GmailNormalizer();
  const normalized = gmail.normalize(GMAIL_PLAIN_MESSAGE, OWNER_USER_ID);
  const existing = new Map([[normalized.documentId, normalized]]);

  const { pipeline, documentRepo } = buildIngestion({ existing });
  const response = await pipeline.runIngestion("gmail", true, OWNER_USER_ID);

  assert.deepEqual(response, { fetched: 1, inserted: 0, updated: 0, skipped: 1, failed: 0 });
  assert.equal(documentRepo.updated.length, 0);
  assert.equal(documentRepo.created.length, 0);
});

test("a changed document is re-indexed under the same owner", async () => {
  const gmail = new GmailNormalizer();
  const normalized = gmail.normalize(GMAIL_PLAIN_MESSAGE, OWNER_USER_ID);
  const existing = new Map([
    [normalized.documentId, { ...normalized, content: "an older body" }],
  ]);

  const { pipeline, documentRepo } = buildIngestion({ existing });
  const response = await pipeline.runIngestion("gmail", true, OWNER_USER_ID);

  assert.deepEqual(response, { fetched: 1, inserted: 0, updated: 1, skipped: 0, failed: 0 });
  assert.deepEqual(documentRepo.updated, [
    { documentId: normalized.documentId, userId: OWNER_USER_ID },
  ]);
});

test("one failing document does not abandon the rest of the batch", async () => {
  class ExplodingNormalizer {
    private calls = 0;

    normalize(raw: unknown, userId: number) {
      this.calls += 1;
      if (this.calls === 1) throw new Error("normalizer exploded");
      return new GmailNormalizer().normalize(raw, userId);
    }
  }

  const { pipeline, documentRepo } = buildIngestion({
    items: [GMAIL_PLAIN_MESSAGE, GMAIL_PLAIN_MESSAGE],
    normalizer: ExplodingNormalizer,
  });

  const response = await pipeline.runIngestion("gmail", true, OWNER_USER_ID);

  assert.deepEqual(response, { fetched: 2, inserted: 1, updated: 0, skipped: 0, failed: 1 });
  assert.equal(documentRepo.created.length, 1);
});

test("calendar events flow through the same accounting", async () => {
  const { pipeline, documentRepo } = buildIngestion({
    items: [CALENDAR_TIMED_EVENT],
    normalizer: GoogleCalendarNormalizer,
  });

  const response = await pipeline.runIngestion("calendar", true, OWNER_USER_ID);

  assert.deepEqual(response, { fetched: 1, inserted: 1, updated: 0, skipped: 0, failed: 0 });
  assert.equal(documentRepo.created[0]?.source, "calendar");
  assert.equal(documentRepo.created[0]?.user_id, OWNER_USER_ID);
});

/* -------------------------------------------------------------------------- */
/* HTTP sync boundary                                                          */
/* -------------------------------------------------------------------------- */

class RecordingIngestionPipeline {
  readonly calls: Array<{ source: string; isFullSync: boolean; userId: number }> = [];

  constructor(
    private readonly result = { fetched: 3, inserted: 2, updated: 1, skipped: 0, failed: 0 },
  ) {}

  async runIngestion(source: string, isFullSync: boolean, userId: number) {
    this.calls.push({ source, isFullSync, userId });
    return this.result;
  }
}

class RecordingEmbeddingPipeline {
  readonly calls: Array<{ userId: number; options: Record<string, unknown> }> = [];

  constructor(
    private readonly result = {
      processed: 3,
      failed: 0,
      pending: 0,
      postgresIndexed: 3,
      vectorIndexed: 3,
      vectorProvider: "chroma",
    },
  ) {}

  async runEmbedding(userId: number, options: Record<string, unknown>) {
    this.calls.push({ userId, options });
    return this.result;
  }
}

function buildSyncController(overrides: {
  ingestion?: RecordingIngestionPipeline;
  embedding?: RecordingEmbeddingPipeline;
  syncLogRepo?: RecordingSyncLogRepository;
} = {}) {
  const syncLogRepo = overrides.syncLogRepo ?? new RecordingSyncLogRepository();
  const ingestionPipeline = overrides.ingestion ?? new RecordingIngestionPipeline();
  const embeddingPipeline = overrides.embedding ?? new RecordingEmbeddingPipeline();

  const controller = new SyncController({
    syncLogRepo: syncLogRepo as never,
    ingestionPipeline: ingestionPipeline as never,
    embeddingPipeline: embeddingPipeline as never,
  });

  return { controller, syncLogRepo, ingestionPipeline, embeddingPipeline };
}

test("starting a Gmail sync answers immediately and logs it for the caller", async () => {
  const { controller, syncLogRepo } = buildSyncController();
  const req = new FakeRequest({ body: { syncType: "full" } });
  const res = new FakeResponse();

  await controller.syncGmail(req as never, res as never);

  assert.deepEqual(syncLogRepo.created, [{ source: "gmail", userId: OWNER_USER_ID }]);
  assert.deepEqual(res.jsonBody, {
    success: true,
    data: { syncId: 5150, status: "running", message: "Gmail sync started" },
  });
});

test("starting a Calendar sync logs it under google_calendar", async () => {
  const { controller, syncLogRepo } = buildSyncController();
  const req = new FakeRequest({ body: {} });
  const res = new FakeResponse();

  await controller.syncCalendar(req as never, res as never);

  assert.deepEqual(syncLogRepo.created, [
    { source: "google_calendar", userId: OWNER_USER_ID },
  ]);
});

test("a successful run maps the sync source to the ingestion key and completes the log", async () => {
  const { controller, syncLogRepo, ingestionPipeline, embeddingPipeline } =
    buildSyncController();

  await controller.performDocumentsSync(
    OWNER_USER_ID,
    "full",
    5150,
    SYNC_SOURCE.GOOGLE_CALENDER,
  );

  assert.deepEqual(ingestionPipeline.calls, [
    { source: "calendar", isFullSync: true, userId: OWNER_USER_ID },
  ]);
  assert.deepEqual(embeddingPipeline.calls, [
    {
      userId: OWNER_USER_ID,
      options: {
        sourceType: "calendar",
        conversationId: "manual_sync:google_calendar:5150",
      },
    },
  ]);

  const [completed] = syncLogRepo.completed;
  assert.equal(completed.userId, OWNER_USER_ID);
  assert.equal(completed.payload.status, "success");
  assert.equal(completed.payload.documentsFetched, 3);
  assert.equal(completed.payload.documentsStored, 3);
});

test("failed ingestion completes the log as failed and skips embedding", async () => {
  const ingestion = new RecordingIngestionPipeline({
    fetched: 3,
    inserted: 1,
    updated: 0,
    skipped: 0,
    failed: 2,
  });
  const { controller, syncLogRepo, embeddingPipeline } = buildSyncController({ ingestion });

  await controller.performDocumentsSync(OWNER_USER_ID, "incremental", 5150, SYNC_SOURCE.GMAIL);

  assert.equal(syncLogRepo.completed[0]?.payload.status, "failed");
  assert.equal(embeddingPipeline.calls.length, 0, "embedding ran on a failed ingestion");
});

test("documents left pending for retrieval indexing fail the sync loudly", async () => {
  const embedding = new RecordingEmbeddingPipeline({
    processed: 1,
    failed: 0,
    pending: 2,
    postgresIndexed: 1,
    vectorIndexed: 1,
    vectorProvider: "chroma",
  });
  const { controller, syncLogRepo } = buildSyncController({ embedding });

  await controller.performDocumentsSync(OWNER_USER_ID, "full", 5150, SYNC_SOURCE.GMAIL);

  const [completed] = syncLogRepo.completed;
  assert.equal(completed.payload.status, "failed");
  assert.match(
    String(completed.payload.error),
    /2 document\(s\) remain pending for retrieval indexing/,
  );
});

test("an unexpected sync error is recorded against the caller's sync log", async () => {
  const ingestion = new RecordingIngestionPipeline();
  ingestion.runIngestion = async () => {
    throw new Error("google refused the token");
  };
  const { controller, syncLogRepo } = buildSyncController({ ingestion });

  await controller.performDocumentsSync(OWNER_USER_ID, "full", 5150, SYNC_SOURCE.GMAIL);

  assert.deepEqual(syncLogRepo.failed, [
    { id: 5150, userId: OWNER_USER_ID, error: "google refused the token" },
  ]);
});

test("sync history rejects an unsupported source before touching the database", async () => {
  const { controller } = buildSyncController();
  const req = new FakeRequest({ query: { source: "spotify" } });
  const res = new FakeResponse();

  await controller.getSyncHistory(req as never, res as never);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.jsonBody, { success: false, error: "Unsupported sync source" });
});

test("sync history clamps the requested limit", async () => {
  const { controller } = buildSyncController();
  const req = new FakeRequest({ query: { source: SYNC_SOURCE.GMAIL, limit: "5000" } });
  const res = new FakeResponse();

  await controller.getSyncHistory(req as never, res as never);

  const history = (res.jsonBody as { data: { history: Array<{ limit: number; userId: number }> } })
    .data.history;
  assert.equal(history[0]?.limit, 100);
  assert.equal(history[0]?.userId, OWNER_USER_ID);
});
