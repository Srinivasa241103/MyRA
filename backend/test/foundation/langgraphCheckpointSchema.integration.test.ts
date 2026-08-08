/**
 * AGT-02 pre-flight — the owned checkpointer schema against a real PostgreSQL.
 *
 * The unit suite proves migration 0003 mirrors the library's DDL as text. This
 * one proves the two agree in a database: after `npm run migrate`, the
 * library's own `setup()` must find nothing left to do, and the library must be
 * able to read and write checkpoints in the schema this repository created.
 *
 * A text-only check would pass happily if `setup()` still created a table or
 * re-ran a migration, which is exactly the failure mode the design exists to
 * prevent.
 *
 *   FND_TEST_DATABASE_URL=postgresql://localhost/myra_fnd_test npm run test:agt-p0:db
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Pool } from "pg";
import { emptyCheckpoint } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import { runMigrations } from "../../src/database/migrations/migrationRunner.js";

const connectionString = process.env.FND_TEST_DATABASE_URL;
const CHECKPOINT_SCHEMA = "langgraph";

if (!connectionString) {
  test("AGT-02 checkpointer schema integration suite", { skip: "Set FND_TEST_DATABASE_URL" }, () => {});
} else {
  const databaseName = new URL(connectionString).pathname.slice(1);
  if (!databaseName.startsWith("myra_fnd_test")) {
    throw new Error("FND_TEST_DATABASE_URL must target a database named myra_fnd_test*");
  }

  const pool = new Pool({ connectionString });

  /**
   * Everything that would differ if the library and this repository disagreed:
   * which tables exist, their columns, and their constraints.
   */
  async function snapshotSchema() {
    const columns = await pool.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default, ordinal_position
         FROM information_schema.columns
        WHERE table_schema = $1
        ORDER BY table_name, ordinal_position`,
      [CHECKPOINT_SCHEMA],
    );
    const constraints = await pool.query(
      `SELECT c.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid) AS definition
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
        ORDER BY c.relname, con.conname`,
      [CHECKPOINT_SCHEMA],
    );
    const versions = await pool.query(
      `SELECT v FROM "${CHECKPOINT_SCHEMA}".checkpoint_migrations ORDER BY v`,
    );

    return {
      columns: columns.rows,
      constraints: constraints.rows,
      versions: versions.rows.map((row) => row.v),
    };
  }

  before(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${CHECKPOINT_SCHEMA}" CASCADE`);
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
  });

  after(async () => {
    await pool.end();
  });

  test("migrations create the checkpointer schema on an empty database", async () => {
    const result = await runMigrations({ pool });

    assert.ok(
      result.applied.some((migration) => migration.name === "0003_agt_02_langgraph_checkpoints.sql"),
      "0003 must apply as part of the ordered migration run",
    );

    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
      [CHECKPOINT_SCHEMA],
    );
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      ["checkpoint_blobs", "checkpoint_migrations", "checkpoint_writes", "checkpoints"],
    );

    // The application tables must not have been dragged into the schema, and
    // the checkpointer tables must not have leaked into public.
    const publicLeak = await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE 'checkpoint%'`,
    );
    assert.deepEqual(publicLeak.rows, [], "checkpointer tables must not exist in the public schema");
  });

  test("the library's own setup() finds nothing left to do", async () => {
    const before_ = await snapshotSchema();
    assert.deepEqual(before_.versions, [0, 1, 2, 3, 4], "0003 must record every library migration index");

    const saver = new PostgresSaver(pool, undefined, { schema: CHECKPOINT_SCHEMA });
    await saver.setup();

    const after_ = await snapshotSchema();
    assert.deepEqual(after_, before_, "setup() changed the schema this repository owns");
  });

  test("the library can round-trip a checkpoint through the owned schema", async () => {
    const saver = new PostgresSaver(pool, undefined, { schema: CHECKPOINT_SCHEMA });
    const threadId = randomUUID();
    const config = { configurable: { thread_id: threadId, checkpoint_ns: "" } };
    const checkpoint = emptyCheckpoint();

    // Channel values live in checkpoint_blobs keyed by (channel, version), and
    // the read path joins them through the checkpoint's own `channel_versions`.
    // Both sides have to name the same version or the value writes and never
    // comes back — which is a property of the schema worth exercising here.
    const saved = await saver.put(
      config,
      {
        ...checkpoint,
        channel_values: { probe: "agt-02-preflight" },
        channel_versions: { probe: 1 },
      },
      { source: "update", step: 1, parents: {} },
      { probe: 1 },
    );
    assert.ok(saved.configurable?.checkpoint_id, "put must return the stored checkpoint id");

    const loaded = await saver.getTuple(config);
    assert.ok(loaded, "the checkpoint written to the owned schema must be readable");
    assert.equal(loaded.checkpoint.channel_values.probe, "agt-02-preflight");

    await saver.deleteThread(threadId);
    assert.equal(await saver.getTuple(config), undefined, "thread deletion must clear the checkpoint");
  });

  test("rerunning the migration is a no-op", async () => {
    const result = await runMigrations({ pool });

    assert.deepEqual(result.applied, [], "an already-applied migration must not run twice");
    assert.ok(result.skipped.includes("0003_agt_02_langgraph_checkpoints.sql"));

    const versions = await pool.query(
      `SELECT v FROM "${CHECKPOINT_SCHEMA}".checkpoint_migrations ORDER BY v`,
    );
    assert.deepEqual(
      versions.rows.map((row) => row.v),
      [0, 1, 2, 3, 4],
      "the ON CONFLICT guard must keep the version ledger stable",
    );
  });
}
