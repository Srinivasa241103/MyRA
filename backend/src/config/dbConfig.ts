import { Pool } from "pg";
import { logger } from "../utils/logger.js";
import { safeErrorMessage } from "./redaction.js";

// Declared as `export let` so all importing modules get a live binding.
// The Pool is created lazily on first call to getPool(), by which point
// dotenv has already loaded .env (ES module imports are hoisted before
// any code runs, so new Pool() at module-eval time would see undefined env vars).
export let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
      connectionTimeoutMillis: 5000,
      max: 10,
    });

    pool.on("error", (err: Error) => {
      // FND-05.6: this used to process.exit(-1), turning a transient error on
      // an idle client into a full outage. Readiness probes — not process
      // death — surface dependency failures now; pg driver errors can embed
      // the connection string, so the message is redacted.
      logger.error("Unexpected error on idle PostgreSQL client", {
        error: safeErrorMessage(err, { dependency: "postgres" }),
      });
    });
  }
  return pool;
}

export const connectToDB = async (): Promise<void> => {
  try {
    const client = await getPool().connect();
    logger.info("[Database connection established successfully.]");
    client.release();
  } catch (error) {
    logger.error("Database connection failed", {
      error: safeErrorMessage(error, { dependency: "postgres" }),
    });
    throw error;
  }
};

/**
 * Close the shared pool and clear the singleton so a later getPool() starts
 * clean. Idempotent — the FND-05.6 shutdown sequence calls it unconditionally,
 * whether or not the pool ever connected.
 */
export async function closePool(): Promise<void> {
  const current = pool;
  if (!current) return;

  pool = undefined;
  await current.end();
  logger.info("PostgreSQL pool closed");
}
