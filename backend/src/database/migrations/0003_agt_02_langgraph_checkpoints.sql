-- AGT-02 pre-flight: own the LangGraph checkpointer schema as a forward-only
-- migration instead of letting the library create its tables at boot.
--
-- Why this file exists at all. `PostgresSaver.setup()` creates tables on first
-- use. That is incompatible with two rules this repository already runs on:
-- migrations are forward-only and must apply to an empty database, and
-- MIGRATIONS_ON_BOOT is "verify" outside development — a process that is not
-- allowed to change the schema must not be silently changing the schema.
--
-- Pinned library: @langchain/langgraph-checkpoint-postgres@1.0.4
-- Mirrors: dist/migrations.js getMigrations("langgraph"), indices 0-4.
--
-- The statements below are a faithful copy of that array, in order, with the
-- schema bound to "langgraph". Nothing is added: no extra index, no extra
-- constraint, no ownership column. A checkpoint table that differs from what
-- the library expects is worse than one this repository does not control, and
-- test/foundation/langgraphCheckpointSchema.unit.test.ts fails the build when
-- the pinned library's DDL and this file drift apart.
--
-- Tenant isolation. These tables carry no user_id, so FND-04's guarantee cannot
-- come from them. It comes from agent_runs: no code path may build a thread
-- config without first loading agent_runs by (id, user_id). AGT-02 enforces
-- that above the checkpointer; recording it here so the absence is a decision
-- rather than an oversight.

CREATE SCHEMA IF NOT EXISTS "langgraph";

-- getMigrations index 0
CREATE TABLE IF NOT EXISTS "langgraph".checkpoint_migrations (
    v INTEGER PRIMARY KEY
  );

-- getMigrations index 1
CREATE TABLE IF NOT EXISTS "langgraph".checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    type TEXT,
    checkpoint JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
  );

-- getMigrations index 2
CREATE TABLE IF NOT EXISTS "langgraph".checkpoint_blobs (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    type TEXT NOT NULL,
    blob BYTEA,
    PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
  );

-- getMigrations index 3
CREATE TABLE IF NOT EXISTS "langgraph".checkpoint_writes (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    type TEXT,
    blob BYTEA NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
  );

-- getMigrations index 4 — a no-op on a fresh database (index 2 already creates
-- `blob` nullable). Kept so this file stays a faithful mirror of the array.
ALTER TABLE "langgraph".checkpoint_blobs ALTER COLUMN blob DROP not null;

-- Record indices 0-4 as applied so the library's own setup() is a no-op rather
-- than a competing schema author. setup() reads MAX(v) and runs only migrations
-- above it; with 0-4 recorded and five migrations pinned, it applies nothing.
--
-- When the library ships a sixth migration, the parity test fails and the fix
-- is a new 0004_* migration in this directory that applies index 5 and records
-- it — never an edit to this file, which is checksummed in schema_migrations.
INSERT INTO "langgraph".checkpoint_migrations (v)
SELECT generate_series(0, 4)
ON CONFLICT (v) DO NOTHING;
