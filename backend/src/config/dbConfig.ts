import { Pool } from "pg";
import { logger } from "../utils/logger.js";

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
      console.error("Unexpected error on idle client", err);
      process.exit(-1);
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
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Database connection failed:", message);
    throw error;
  }
};
