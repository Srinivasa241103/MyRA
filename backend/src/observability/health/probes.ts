/**
 * FND-05.4 — dependency probes for PostgreSQL, Chroma, Redis, and migrations.
 *
 * Each factory returns a `ProbeDefinition` with production defaults resolved
 * from the validated runtime config, and every dependency injectable so the
 * unit tests run without any live service. Probes are free to throw — the
 * registry converts failures into redacted `down` results — so only the
 * probes with non-trivial status mapping (redis, migrations) build their own
 * outcomes.
 *
 * Per-probe behaviour (FND-05 plan):
 *   postgres    SELECT 1. Required always — the one hard dependency at every
 *               stage of the project.
 *   chroma      Heartbeat. `skipped` when VECTOR_STORE=pgvector, not `down`:
 *               an unused service must never fail readiness.
 *   redis       PING. Failure → `degraded` while `redis.required` is false;
 *               TOL-03 flips the flag and the same failure becomes `down`.
 *   migrations  Compares the `schema_migrations` ledger against the FND-03
 *               runner's `discoverMigrations()`. Pending in `verify` mode →
 *               `down`; in `auto` mode boot applies them, so → `degraded`.
 *               Checksum drift and vanished history are `down` in any mode.
 */

import { getPool } from "../../config/dbConfig.js";
import { pingRedis, type RedisPingResult } from "../../config/redisClient.js";
import { getRuntimeConfig, type MigrationMode, type RuntimeConfig } from "../../config/runtimeConfig.js";
import {
  discoverMigrations,
  type MigrationFile,
} from "../../database/migrations/migrationRunner.js";
import { DEFAULT_PROBE_TIMEOUT_MS } from "./registry.js";
import type { ProbeDefinition } from "./probeTypes.js";

/* -------------------------------------------------------------------------- */
/* postgres                                                                     */
/* -------------------------------------------------------------------------- */

export interface PostgresProbeOptions {
  /** Injectable query runner; defaults to the shared pool from `dbConfig`. */
  query?: (sql: string) => Promise<unknown>;
}

export function postgresProbe(options: PostgresProbeOptions = {}): ProbeDefinition {
  const query = options.query ?? ((sql: string) => getPool().query(sql));

  return {
    name: "postgres",
    required: true,
    async run() {
      // Failures propagate: the registry redacts driver messages, which for
      // pg routinely embed the connection string.
      await query("SELECT 1");
      return { status: "ok" };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* chroma                                                                       */
/* -------------------------------------------------------------------------- */

// Mirrors chromaVectorStore.ts: with CHROMA_API_KEY set, an unset host/port
// means Chroma Cloud's endpoint — not the localhost defaults that
// runtimeConfig fills in for the local-container case.
const DEFAULT_CHROMA_CLOUD_HOST = "api.trychroma.com";
const DEFAULT_CHROMA_CLOUD_PORT = 443;
const LOCAL_DEFAULT_HOST = "localhost";
const LOCAL_DEFAULT_PORT = 8000;

/** Grace period between the registry's verdict and the socket being torn down. */
const ABORT_GRACE_MS = 250;

export interface ChromaHeartbeatTarget {
  mode: "cloud" | "local";
  url: string;
  headers?: Record<string, string>;
}

/**
 * Resolve the heartbeat endpoint the same way `chromaVectorStore` resolves
 * its base URL, so the probe watches the service the store actually talks to.
 */
export function resolveChromaHeartbeat(vector: RuntimeConfig["vector"]): ChromaHeartbeatTarget {
  if (vector.chromaCloud) {
    const host = vector.chromaHost === LOCAL_DEFAULT_HOST
      ? DEFAULT_CHROMA_CLOUD_HOST
      : vector.chromaHost;
    const port = vector.chromaPort === LOCAL_DEFAULT_PORT
      ? DEFAULT_CHROMA_CLOUD_PORT
      : vector.chromaPort;

    return {
      mode: "cloud",
      url: `https://${host}:${port}/api/v2/heartbeat`,
      headers: vector.chromaApiKey ? { "x-chroma-token": vector.chromaApiKey } : undefined,
    };
  }

  const scheme = vector.chromaSsl ? "https" : "http";
  return {
    mode: "local",
    url: `${scheme}://${vector.chromaHost}:${vector.chromaPort}/api/v2/heartbeat`,
  };
}

export interface ChromaProbeOptions {
  /** Vector-store configuration; defaults to the validated runtime config. */
  vector?: RuntimeConfig["vector"];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function chromaProbe(options: ChromaProbeOptions = {}): ProbeDefinition {
  const vector = options.vector ?? getRuntimeConfig().vector;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const usesChroma = vector.provider === "chroma";

  return {
    name: "chroma",
    required: usesChroma,
    timeoutMs,
    async run() {
      if (!usesChroma) {
        // pgvector serves retrieval; an unprobed Chroma is irrelevant, not down.
        return { status: "skipped" as const, detail: "not in use: VECTOR_STORE=pgvector" };
      }

      const target = resolveChromaHeartbeat(vector);

      // The abort fires *after* the registry timeout so the operator sees the
      // registry's "probe timed out" message, while the socket still gets
      // cleaned up instead of lingering until the OS gives up on it.
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), timeoutMs + ABORT_GRACE_MS);

      try {
        const response = await fetchImpl(target.url, {
          headers: target.headers,
          signal: controller.signal,
        });

        if (!response.ok) {
          return {
            status: "down" as const,
            detail: `chroma: heartbeat returned HTTP ${response.status} (${target.mode})`,
          };
        }

        return { status: "ok" as const };
      } finally {
        clearTimeout(abortTimer);
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* redis                                                                        */
/* -------------------------------------------------------------------------- */

export interface RedisProbeOptions {
  /** Declarative requiredness; defaults to `redis.required` (false until TOL-03). */
  required?: boolean;
  /** Injectable ping; defaults to the FND-05.3 client's `pingRedis`. */
  ping?: (options?: { connectTimeoutMs?: number }) => Promise<RedisPingResult>;
  connectTimeoutMs?: number;
}

export function redisProbe(options: RedisProbeOptions = {}): ProbeDefinition {
  const required = options.required ?? getRuntimeConfig().redis.required;
  const ping = options.ping ?? pingRedis;

  return {
    name: "redis",
    required,
    async run() {
      const result = await ping(
        options.connectTimeoutMs !== undefined
          ? { connectTimeoutMs: options.connectTimeoutMs }
          : undefined,
      );

      if (result.ok) {
        return { status: "ok", latencyMs: result.latencyMs };
      }

      return {
        // `pingRedis` never throws and its error is already redacted, so the
        // failure can be mapped instead of falling through to the registry:
        // an optional Redis degrades readiness rather than failing it.
        status: required ? "down" : "degraded",
        detail: result.error,
        latencyMs: result.latencyMs,
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* migrations                                                                   */
/* -------------------------------------------------------------------------- */

/** PostgreSQL `undefined_table` — a fresh database with no ledger yet. */
const MISSING_TABLE_CODE = "42P01";

export interface MigrationsProbeOptions {
  /** `auto` | `verify`; defaults to `runtime.migrationsOnBoot`. */
  mode?: MigrationMode;
  /** Injectable discovery; defaults to the FND-03 runner's `discoverMigrations`. */
  discover?: () => Promise<MigrationFile[]>;
  /** Injectable ledger read; defaults to the shared pool. */
  query?: (sql: string) => Promise<{ rows: Array<{ name: string; checksum: string }> }>;
}

export function migrationsProbe(options: MigrationsProbeOptions = {}): ProbeDefinition {
  const mode = options.mode ?? getRuntimeConfig().runtime.migrationsOnBoot;
  const discover = options.discover ?? (() => discoverMigrations());
  const query = options.query ?? ((sql: string) => getPool().query(sql));

  return {
    name: "migrations",
    required: true,
    async run() {
      const discovered = await discover();

      let ledger: Array<{ name: string; checksum: string }>;
      try {
        const result = await query("SELECT name, checksum FROM schema_migrations ORDER BY name");
        ledger = result.rows;
      } catch (error) {
        if ((error as { code?: unknown }).code === MISSING_TABLE_CODE) {
          // The runner creates the ledger on first use, so a missing table
          // just means every discovered migration is pending.
          ledger = [];
        } else {
          throw error;
        }
      }

      const discoveredByName = new Map(discovered.map((m) => [m.name, m.checksum]));
      const appliedByName = new Map(ledger.map((row) => [row.name, row.checksum]));

      // Same invariants the FND-03 runner enforces at apply time: history is
      // append-only and applied SQL is immutable. Migration names are
      // repository filenames — safe to surface.
      const vanished = ledger
        .filter((row) => !discoveredByName.has(row.name))
        .map((row) => row.name);
      if (vanished.length > 0) {
        return {
          status: "down" as const,
          detail: `migrations: applied migrations missing from the repository: ${vanished.join(", ")}`,
        };
      }

      const mismatched = discovered
        .filter((m) => {
          const applied = appliedByName.get(m.name);
          return applied !== undefined && applied !== m.checksum;
        })
        .map((m) => m.name);
      if (mismatched.length > 0) {
        return {
          status: "down" as const,
          detail: `migrations: checksum mismatch for ${mismatched.join(", ")}`,
        };
      }

      const pending = discovered
        .filter((m) => !appliedByName.has(m.name))
        .map((m) => m.name);
      if (pending.length > 0) {
        return {
          // In `auto` mode the FND-05.6 boot sequence applies these before the
          // service reports ready; in `verify` mode drift must block readiness.
          status: mode === "verify" ? ("down" as const) : ("degraded" as const),
          detail: `migrations: ${appliedByName.size} applied, ${pending.length} pending: ${pending.join(", ")}`,
        };
      }

      return { status: "ok" as const };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* standard set                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The four FND-05 probes wired to a validated config — the set the FND-05.5
 * readiness endpoint runs. Every probe carries the configured timeout so one
 * hung dependency is bounded by READINESS_PROBE_TIMEOUT_MS.
 */
export function defaultProbes(config: RuntimeConfig = getRuntimeConfig()): ProbeDefinition[] {
  const timeoutMs = config.runtime.readinessProbeTimeoutMs;

  // The Redis connect deadline sits just inside the probe timeout so
  // `pingRedis` reports its own (already redacted, correctly degraded-mapped)
  // failure before the registry's harder `down`-on-timeout verdict lands.
  const redisConnectTimeoutMs = Math.max(100, timeoutMs - ABORT_GRACE_MS);

  return [
    { ...postgresProbe(), timeoutMs },
    chromaProbe({ vector: config.vector, timeoutMs }),
    {
      ...redisProbe({
        required: config.redis.required,
        connectTimeoutMs: redisConnectTimeoutMs,
      }),
      timeoutMs,
    },
    { ...migrationsProbe({ mode: config.runtime.migrationsOnBoot }), timeoutMs },
  ];
}
