/**
 * AGT-02 pre-flight — the LangGraph checkpointer schema is owned by migration
 * 0003, not by the library's setup().
 *
 * The property under test is drift: migration files are checksummed and can
 * never be edited, so if a library upgrade changes the checkpointer DDL, the
 * schema this repository creates and the schema the library queries silently
 * diverge — and the symptom is a failed resume in production, not a failed
 * build. This suite turns that into a build failure.
 *
 * It reads the library's own migration array rather than a copy of it. The
 * package's export map does not expose `dist/migrations.js`, so it is loaded by
 * file URL, which bypasses the map without reaching into a private API surface
 * at runtime — this is a test, and it is the only place that indirection lives.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { DEFAULT_MIGRATIONS_DIRECTORY } from "../../src/database/migrations/migrationRunner.js";

const MIGRATION_FILE = "0003_agt_02_langgraph_checkpoints.sql";
const CHECKPOINT_SCHEMA = "langgraph";
const PACKAGE_NAME = "@langchain/langgraph-checkpoint-postgres";

const require_ = createRequire(import.meta.url);

interface CheckpointPackage {
  version: string;
  getMigrations: (schema: string) => string[];
}

async function loadCheckpointPackage(): Promise<CheckpointPackage> {
  const manifestPath = require_.resolve(`${PACKAGE_NAME}/package.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version: string };
  const migrationsPath = join(dirname(manifestPath), "dist", "migrations.js");
  const module_ = (await import(pathToFileURL(migrationsPath).href)) as {
    getMigrations: (schema: string) => string[];
  };

  return { version: manifest.version, getMigrations: module_.getMigrations };
}

async function readOwnedMigration(): Promise<string> {
  return readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, MIGRATION_FILE), "utf8");
}

/** Comparison is whitespace-insensitive so formatting is not a false alarm. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/** Strip `--` comments so a statement mentioned in prose cannot fake a match. */
function withoutComments(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, "");
}

function statementsOf(sql: string): string[] {
  return withoutComments(sql)
    .split(";")
    .map(normalize)
    .filter((statement) => statement.length > 0);
}

test("the pinned library version matches the version installed", async () => {
  const [pkg, sql] = await Promise.all([loadCheckpointPackage(), readOwnedMigration()]);
  const pinned = sql.match(/@langchain\/langgraph-checkpoint-postgres@(\d+\.\d+\.\d+)/);

  assert.ok(pinned, "migration 0003 must record the library version it mirrors");
  assert.equal(
    pinned[1],
    pkg.version,
    "the checkpointer library was upgraded without a new migration; add 0004 rather than editing 0003",
  );
});

test("migration 0003 contains every library migration statement, in order", async () => {
  const [pkg, sql] = await Promise.all([loadCheckpointPackage(), readOwnedMigration()]);
  const owned = normalize(withoutComments(sql));

  let cursor = 0;
  for (const [index, statement] of pkg.getMigrations(CHECKPOINT_SCHEMA).entries()) {
    const expected = normalize(statement).replace(/;$/, "");
    const found = owned.indexOf(expected, cursor);

    assert.notEqual(
      found,
      -1,
      `library migration ${index} is missing from ${MIGRATION_FILE}:\n${expected}`,
    );
    cursor = found + expected.length;
  }
});

test("migration 0003 adds nothing the library does not create", async () => {
  const [pkg, sql] = await Promise.all([loadCheckpointPackage(), readOwnedMigration()]);
  const libraryStatements = new Set(
    pkg.getMigrations(CHECKPOINT_SCHEMA).map((statement) => normalize(statement).replace(/;$/, "")),
  );

  // The two statements that are ours by design: creating the schema the library
  // would otherwise create inside setup(), and recording setup()'s own version
  // ledger so it has nothing left to do.
  const allowedExtras = [/^CREATE SCHEMA IF NOT EXISTS "langgraph"$/i, /^INSERT INTO "langgraph"\.checkpoint_migrations/i];

  for (const statement of statementsOf(sql)) {
    if (libraryStatements.has(statement)) continue;
    assert.ok(
      allowedExtras.some((pattern) => pattern.test(statement)),
      `${MIGRATION_FILE} creates something the library does not:\n${statement}`,
    );
  }
});

test("every library migration index is recorded so setup() is a no-op", async () => {
  const [pkg, sql] = await Promise.all([loadCheckpointPackage(), readOwnedMigration()]);
  const highestIndex = pkg.getMigrations(CHECKPOINT_SCHEMA).length - 1;
  const recorded = withoutComments(sql).match(/generate_series\(\s*0\s*,\s*(\d+)\s*\)/);

  assert.ok(recorded, "migration 0003 must record the applied checkpointer versions");
  assert.equal(
    Number(recorded[1]),
    highestIndex,
    `the library ships ${highestIndex + 1} migrations; 0003 records 0..${recorded[1]}`,
  );
});

test("the checkpointer schema is namespaced away from application tables", async () => {
  const sql = await readOwnedMigration();

  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS "langgraph"/);
  for (const table of ["checkpoints", "checkpoint_blobs", "checkpoint_writes", "checkpoint_migrations"]) {
    assert.match(
      sql,
      new RegExp(`"langgraph"\\.${table}`),
      `${table} must live in the langgraph schema, never in public`,
    );
  }
});

test("the checkpoint tables carry no user column, and the migration says why", async () => {
  const sql = await readOwnedMigration();

  // If a user_id ever appears here it means someone tried to solve tenant
  // isolation in the checkpoint tables. It does not work — the library writes
  // these rows and knows nothing about MyRA users — and it would give a false
  // sense of a boundary that actually lives in agent_runs.
  assert.equal(
    /user_id/i.test(withoutComments(sql)),
    false,
    "checkpoint tables must not carry user_id; isolation is enforced above them",
  );
  assert.match(sql, /agent_runs by \(id, user_id\)/, "the isolation decision must be recorded in the file");
});
