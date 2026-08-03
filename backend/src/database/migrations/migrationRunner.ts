import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";
import { getPool } from "../../config/dbConfig.js";

const MIGRATION_FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;
const MIGRATION_LOCK_KEY = 741_030_003;

export const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(new URL("./", import.meta.url));

export interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
  appliedAt: Date;
  executionMs: number;
}

export interface MigrationResult {
  applied: AppliedMigration[];
  skipped: string[];
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export async function discoverMigrations(
  directory = DEFAULT_MIGRATIONS_DIRECTORY,
): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && MIGRATION_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const versions = new Set<number>();
  const migrations: MigrationFile[] = [];

  for (const name of files) {
    const match = name.match(MIGRATION_FILE_PATTERN);
    if (!match) continue;

    const version = Number(match[1]);
    if (versions.has(version)) {
      throw new Error(`Duplicate database migration version: ${match[1]}`);
    }
    versions.add(version);

    const sql = await readFile(join(directory, name), "utf8");
    migrations.push({ version, name, sql, checksum: checksum(sql) });
  }

  return migrations;
}

async function ensureMigrationLedger(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      execution_ms INTEGER NOT NULL CHECK (execution_ms >= 0),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function runMigrations({
  pool = getPool(),
  directory = DEFAULT_MIGRATIONS_DIRECTORY,
}: {
  pool?: Pool;
  directory?: string;
} = {}): Promise<MigrationResult> {
  const migrations = await discoverMigrations(directory);
  const client = await pool.connect();
  const result: MigrationResult = { applied: [], skipped: [] };

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await ensureMigrationLedger(client);

    const ledger = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM schema_migrations ORDER BY name",
    );
    const appliedByName = new Map(ledger.rows.map((row) => [row.name, row.checksum]));
    const discoveredNames = new Set(migrations.map((migration) => migration.name));

    for (const applied of ledger.rows) {
      if (!discoveredNames.has(applied.name)) {
        throw new Error(
          `Applied migration ${applied.name} is missing from the repository; migration history is append-only`,
        );
      }
    }

    for (const migration of migrations) {
      const appliedChecksum = appliedByName.get(migration.name);
      if (appliedChecksum) {
        if (appliedChecksum !== migration.checksum) {
          throw new Error(
            `Checksum mismatch for applied migration ${migration.name}; create a new migration instead of editing history`,
          );
        }
        result.skipped.push(migration.name);
        continue;
      }

      const startedAt = performance.now();
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        const executionMs = Math.max(0, Math.round(performance.now() - startedAt));
        const inserted = await client.query<{
          name: string;
          checksum: string;
          applied_at: Date;
          execution_ms: number;
        }>(
          `INSERT INTO schema_migrations (name, checksum, execution_ms)
           VALUES ($1, $2, $3)
           RETURNING name, checksum, applied_at, execution_ms`,
          [migration.name, migration.checksum, executionMs],
        );
        await client.query("COMMIT");

        const row = inserted.rows[0];
        result.applied.push({
          name: row.name,
          checksum: row.checksum,
          appliedAt: row.applied_at,
          executionMs: row.execution_ms,
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${migration.name} failed`, { cause: error });
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    } finally {
      client.release();
    }
  }

  return result;
}
