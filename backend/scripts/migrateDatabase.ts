import "dotenv/config";
import { getPool } from "../src/config/dbConfig.js";
import { runMigrations } from "../src/database/migrations/migrationRunner.js";

async function main(): Promise<void> {
  const pool = getPool();

  try {
    const result = await runMigrations({ pool });
    for (const migration of result.applied) {
      console.log(`Applied ${migration.name} (${migration.executionMs} ms)`);
    }
    if (result.applied.length === 0) {
      console.log(`Database is current (${result.skipped.length} migration(s) already applied)`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Database migration failed: ${message}`);
  process.exitCode = 1;
});
