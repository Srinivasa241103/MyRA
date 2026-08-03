/**
 * FND-05.3 — Redis client.
 *
 * Redis is declared in package.json but had no code before this module. Nothing
 * consumes it yet: TOL-03 introduces idempotency locks and circuit state, AGT-05
 * the run cancellation signal, and ING-03 the job queue. FND-05 builds only the
 * connection and a probe surface, so `redis.required` defaults to false and an
 * unreachable Redis degrades readiness rather than failing it.
 *
 * Deliberate contrast with `dbConfig.ts`: that module installs a pool error
 * handler that calls `process.exit(-1)`, so a transient Postgres blip kills the
 * process. This module never exits. Connection failures surface as probe
 * results and redacted log lines. (Fixing dbConfig is queued for FND-05.6.)
 */

import { createClient } from "redis";
import { logger } from "../utils/logger.js";
import { safeErrorMessage } from "./redaction.js";
import { getRuntimeConfig } from "./runtimeConfig.js";

export type RedisClient = ReturnType<typeof createClient>;

/** Base delay for the first reconnect attempt. */
const DEFAULT_BASE_RECONNECT_DELAY_MS = 100;
/** Ceiling for exponential backoff, so a long outage settles at a steady poll. */
const DEFAULT_MAX_RECONNECT_DELAY_MS = 5_000;
/** How long `connectRedis` waits before giving up on the initial connection. */
const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
/** Suppress repeat error logs during a sustained outage. */
const DEFAULT_ERROR_LOG_INTERVAL_MS = 30_000;

export interface ReconnectStrategyOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Jitter fraction, 0–1. Injectable randomness keeps the unit test deterministic. */
  jitterRatio?: number;
  random?: () => number;
}

/**
 * Capped exponential backoff with jitter.
 *
 * Retries indefinitely rather than giving up: Redis is optional here, the probe
 * reports its state, and a self-healing client means recovery needs no restart.
 * The cap keeps a long outage at a steady poll instead of an ever-growing delay,
 * and the jitter stops multiple instances reconnecting in lockstep.
 */
export function buildReconnectStrategy(
  options: ReconnectStrategyOptions = {},
): (retries: number) => number {
  const {
    baseDelayMs = DEFAULT_BASE_RECONNECT_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_RECONNECT_DELAY_MS,
    jitterRatio = 0.2,
    random = Math.random,
  } = options;

  return (retries: number): number => {
    const attempt = Math.max(0, retries);
    const exponential = baseDelayMs * 2 ** Math.min(attempt, 30);
    const capped = Math.min(exponential, maxDelayMs);
    const jitter = capped * jitterRatio * (random() * 2 - 1);

    return Math.max(0, Math.round(capped + jitter));
  };
}

/**
 * Rate-limit repeated error logs. A dead Redis with a 5s reconnect cap would
 * otherwise emit ~12 identical lines per minute forever.
 */
export function createErrorLogThrottle(
  intervalMs = DEFAULT_ERROR_LOG_INTERVAL_MS,
  now: () => number = Date.now,
): (message: string) => boolean {
  let lastLoggedAt: number | undefined;
  let lastMessage: string | undefined;

  return (message: string): boolean => {
    const timestamp = now();

    if (message !== lastMessage || lastLoggedAt === undefined) {
      lastMessage = message;
      lastLoggedAt = timestamp;
      return true;
    }

    if (timestamp - lastLoggedAt >= intervalMs) {
      lastLoggedAt = timestamp;
      return true;
    }

    return false;
  };
}

export interface CreateRedisClientOptions {
  url?: string;
  connectTimeoutMs?: number;
  reconnect?: ReconnectStrategyOptions;
  errorLogIntervalMs?: number;
}

/**
 * Build a client without performing any I/O. `createClient` does not connect;
 * `connectRedis` does. An `error` listener is attached immediately because
 * node-redis emits `error` on an EventEmitter — without a listener, Node treats
 * it as an unhandled error event and crashes the process.
 */
export function createRedisClient(options: CreateRedisClientOptions = {}): RedisClient {
  const {
    url = getRuntimeConfig().redis.url,
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    reconnect,
    errorLogIntervalMs = DEFAULT_ERROR_LOG_INTERVAL_MS,
  } = options;

  const client = createClient({
    url,
    socket: {
      connectTimeout: connectTimeoutMs,
      reconnectStrategy: buildReconnectStrategy(reconnect),
    },
  });

  const shouldLog = createErrorLogThrottle(errorLogIntervalMs);

  client.on("error", (error: unknown) => {
    const message = safeErrorMessage(error, { dependency: "redis" });
    if (shouldLog(message)) {
      // Warn, not error: Redis is optional at this stage and readiness reporting
      // — not log severity — is what surfaces the outage.
      logger.warn("Redis connection error", { message });
    }
  });

  return client;
}

/* -------------------------------------------------------------------------- */
/* singleton                                                                   */
/* -------------------------------------------------------------------------- */

let client: RedisClient | undefined;

/** Lazily build the shared client. Performs no I/O. */
export function getRedis(options: CreateRedisClientOptions = {}): RedisClient {
  if (!client) client = createRedisClient(options);
  return client;
}

export function isRedisConnected(): boolean {
  return client?.isReady === true;
}

function timeout(ms: number, label: string): { promise: Promise<never>; cancel: () => void } {
  let handle: NodeJS.Timeout;
  const promise = new Promise<never>((_resolve, reject) => {
    handle = setTimeout(() => reject(new Error(label)), ms);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

/**
 * Connect, bounded by `connectTimeoutMs`.
 *
 * The race matters: the reconnect strategy retries indefinitely, so a bare
 * `connect()` against a dead server never settles and would hang startup and
 * the readiness endpoint. On timeout the client is destroyed and the singleton
 * cleared so a later call starts from a clean state instead of inheriting a
 * client stuck in a retry loop.
 */
export async function connectRedis(
  options: CreateRedisClientOptions = {},
): Promise<RedisClient> {
  const instance = getRedis(options);
  if (instance.isReady) return instance;

  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const timer = timeout(connectTimeoutMs, `connection timed out after ${connectTimeoutMs}ms`);

  try {
    await Promise.race([instance.connect(), timer.promise]);
    logger.info("Redis connection established");
    return instance;
  } catch (error) {
    await destroyQuietly(instance);
    if (client === instance) client = undefined;
    throw new Error(safeErrorMessage(error, { dependency: "redis" }));
  } finally {
    timer.cancel();
  }
}

export interface RedisPingResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/**
 * Connectivity check for the FND-05.4 readiness probe. Never throws: a probe
 * reports status, it does not propagate failure.
 */
export async function pingRedis(
  options: CreateRedisClientOptions = {},
): Promise<RedisPingResult> {
  const startedAt = performance.now();

  try {
    const instance = await connectRedis(options);
    const reply = await instance.ping();
    const latencyMs = Math.round(performance.now() - startedAt);

    return reply === "PONG"
      ? { ok: true, latencyMs }
      : { ok: false, latencyMs, error: `unexpected PING reply: ${String(reply)}` };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: safeErrorMessage(error, { dependency: "redis" }),
    };
  }
}

async function destroyQuietly(instance: RedisClient): Promise<void> {
  try {
    // destroy() is synchronous and safe on a client that never opened;
    // quit() throws ClientClosedError in that state.
    instance.destroy();
  } catch {
    // A client that was never opened has nothing to tear down.
  }
}

/**
 * Close the shared client. Idempotent, and safe to call when Redis never
 * connected — FND-05.6 invokes it unconditionally during shutdown.
 */
export async function closeRedis(): Promise<void> {
  const instance = client;
  if (!instance) return;

  client = undefined;

  try {
    if (instance.isOpen) {
      await instance.quit();
      logger.info("Redis connection closed");
      return;
    }
  } catch (error) {
    logger.warn("Redis graceful close failed; destroying connection", {
      message: safeErrorMessage(error, { dependency: "redis" }),
    });
  }

  await destroyQuietly(instance);
}

export function resetRedisForTests(): void {
  const instance = client;
  client = undefined;
  if (instance) void destroyQuietly(instance);
}
