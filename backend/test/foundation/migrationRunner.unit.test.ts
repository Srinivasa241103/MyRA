import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  discoverMigrations,
  runMigrations,
} from "../../src/database/migrations/migrationRunner.js";

test("migration discovery is ordered and works in paths containing spaces", async () => {
  const directory = await mkdtemp(join(tmpdir(), "myra migrations "));
  try {
    await writeFile(join(directory, "0002_second.sql"), "SELECT 2;\n");
    await writeFile(join(directory, "0001_first.sql"), "SELECT 1;\n");
    await writeFile(join(directory, "README.md"), "ignored\n");

    const migrations = await discoverMigrations(directory);
    assert.deepEqual(
      migrations.map(({ version, name }) => ({ version, name })),
      [
        { version: 1, name: "0001_first.sql" },
        { version: 2, name: "0002_second.sql" },
      ],
    );
    assert.match(migrations[0].checksum, /^[a-f0-9]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("duplicate migration versions are rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "myra-migrations-"));
  try {
    await writeFile(join(directory, "0001_first.sql"), "SELECT 1;\n");
    await writeFile(join(directory, "0001_duplicate.sql"), "SELECT 2;\n");
    await assert.rejects(
      discoverMigrations(directory),
      /Duplicate database migration version: 0001/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an applied migration cannot disappear from append-only history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "myra-migrations-"));
  const queries: string[] = [];
  const client = {
    async query(text: string) {
      queries.push(text);
      if (/SELECT name, checksum FROM schema_migrations/.test(text)) {
        return {
          rows: [{ name: "0001_removed.sql", checksum: "a".repeat(64) }],
        };
      }
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
  };

  try {
    await assert.rejects(
      runMigrations({ pool: pool as any, directory }),
      /Applied migration 0001_removed\.sql is missing from the repository/,
    );
    assert.ok(queries.some((query) => /pg_advisory_unlock/.test(query)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
