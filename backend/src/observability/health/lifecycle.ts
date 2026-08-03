/**
 * FND-05.6 — startup/shutdown lifecycle.
 *
 * Extracted from the entrypoint so the ordering is testable. `index.js` owns
 * the process — the listener, the signal handlers, `process.exit` — and hands
 * this module injectable effects; every default resolves to the real
 * implementation, so the entrypoint wires only what is process-specific.
 *
 * Boot order (FND-05 plan):
 *
 *   1  validate config → log safe summary
 *   2  bind listener immediately, phase=starting, serve /health/* only
 *   3  connect Postgres
 *   4  migrations: apply (dev/auto) | verify (else)
 *   5  run probes
 *   6  phase=ready
 *
 * Step 2 is what makes "backend stays unready when a required dependency is
 * unavailable" literally testable: the process boots, answers /health/live 200
 * and /health/ready 503, and *retries* steps 3–5 with capped backoff instead of
 * refusing to start. When the dependency returns, the service becomes ready
 * without a restart.
 *
 * Shutdown order (SIGTERM/SIGINT, idempotent):
 *
 *   1  phase=draining → /health/ready starts 503ing
 *   2  stop cron
 *   3  disconnect websockets, stop accepting connections
 *   4  drain in-flight requests, bounded by SHUTDOWN_DRAIN_TIMEOUT_MS
 *   5  close redis → pg pool
 *   6  exit 0 | deadline exceeded or a step failed → exit 1
 *
 * Honest scoping, recorded in docs/implementation/FND-05.6.md: the spec's
 * "shutdown does not leave a half-executed action marked successful" cannot be
 * fully proven here — there are no actions until CAL-06. The drain mechanism
 * makes it structurally possible; the action-specific assertion lands with
 * CAL-06.
 */

import { closePool, connectToDB } from "../../config/dbConfig.js";
import { safeErrorMessage } from "../../config/redaction.js";
import { closeRedis } from "../../config/redisClient.js";
import {
  describeRuntimeConfig,
  getRuntimeConfig,
  type RuntimeConfig,
} from "../../config/runtimeConfig.js";
import {
  runMigrations,
  type MigrationResult,
} from "../../database/migrations/migrationRunner.js";
import { logger } from "../../utils/logger.js";
import { isReadyFromProbes, type ProbeRunner } from "./probeContract.js";
import { setProbeRunner } from "./probeRegistration.js";
import { defaultProbes } from "./probes.js";
import { createProbeRunner } from "./registry.js";
import { readinessState, type ReadinessState } from "./readinessState.js";

/** Structural subset of the app logger, injectable for assertion in tests. */
export interface LifecycleLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const DEFAULT_STARTUP_RETRY_DELAY_MS = 1_000;
const DEFAULT_STARTUP_RETRY_MAX_DELAY_MS = 30_000;
/** Mirrors the SHUTDOWN_DRAIN_TIMEOUT_MS default in `runtimeConfig.ts`. */
const FALLBACK_DRAIN_TIMEOUT_MS = 10_000;

/**
 * setTimeout that never keeps the process alive on its own: a pending startup
 * retry must not block an exit that shutdown has already decided on.
 */
function sleepUnref(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const handle = setTimeout(resolve, ms);
    handle.unref?.();
  });
}

/* -------------------------------------------------------------------------- */
/* startup                                                                     */
/* -------------------------------------------------------------------------- */

export interface StartupOptions {
  /**
   * Binds the HTTP listener (and attaches websockets). Must resolve once the
   * server is accepting connections. A rejection here — port in use — aborts
   * startup entirely: a process that cannot even serve /health/* has nothing
   * to report unreadiness with.
   */
  bindListener: (config: RuntimeConfig) => Promise<void>;
  /** Defaults to the memoized config so the whole process shares one instance. */
  loadConfig?: () => RuntimeConfig;
  readiness?: ReadinessState;
  log?: LifecycleLogger;
  connectPostgres?: () => Promise<void>;
  applyMigrations?: () => Promise<MigrationResult>;
  buildProbeRunner?: (config: RuntimeConfig) => ProbeRunner;
  registerProbeRunner?: (runner: ProbeRunner | null) => void;
  /** Started only once the service is ready and only when cron is enabled. */
  startCron?: () => void;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface StartupResult {
  config: RuntimeConfig;
  /** False when shutdown aborted the boot before readiness. */
  ready: boolean;
  /** Dependency attempts made (1 = ready on the first pass). */
  attempts: number;
}

export async function startup(options: StartupOptions): Promise<StartupResult> {
  const {
    bindListener,
    loadConfig = getRuntimeConfig,
    readiness = readinessState,
    log = logger,
    connectPostgres = connectToDB,
    applyMigrations = () => runMigrations(),
    buildProbeRunner = (config) =>
      createProbeRunner(() => defaultProbes(config), {
        timeoutMs: config.runtime.readinessProbeTimeoutMs,
      }),
    registerProbeRunner = setProbeRunner,
    startCron,
    retryDelayMs = DEFAULT_STARTUP_RETRY_DELAY_MS,
    maxRetryDelayMs = DEFAULT_STARTUP_RETRY_MAX_DELAY_MS,
    sleep = sleepUnref,
  } = options;

  // 1 — validate configuration before anything observable happens. Invalid
  // config throws ConfigValidationError — variable names, never values — and
  // the entrypoint decides what failure means. Valid config logs the log-safe
  // summary, which reports secrets only as set/unset.
  const config = loadConfig();
  log.info("Runtime configuration validated", {
    config: describeRuntimeConfig(config) as unknown as Record<string, unknown>,
  });

  // Register the probe runner before binding: the fail-closed default in
  // probeRegistration would otherwise report "probe runner not registered"
  // for the whole boot window.
  const runProbes = buildProbeRunner(config);
  registerProbeRunner(runProbes);

  // 2 — bind the listener before touching any dependency. From here on the
  // process answers /health/live 200 and /health/ready 503 while it boots;
  // app.js gates application routes until startup completes.
  await bindListener(config);
  log.info("HTTP listener bound; connecting dependencies", {
    port: config.server.port,
    phase: readiness.phase,
  });

  // 3–5 — connect Postgres, settle migrations, and probe until every required
  // dependency answers. Failures log a redacted reason and retry with capped
  // exponential backoff; the service stays reachable-but-unready throughout.
  // Shutdown aborts the loop through the phase check: draining is terminal-ward,
  // so the loop cannot resurrect a process that has decided to leave.
  let attempts = 0;
  while (readiness.phase === "starting") {
    attempts += 1;
    let blocking: string;

    try {
      await connectPostgres();

      if (config.runtime.migrationsOnBoot === "auto") {
        const migrations = await applyMigrations();
        if (migrations.applied.length > 0) {
          // Migration names are repository filenames — safe to log.
          log.info("Applied pending migrations", {
            applied: migrations.applied.map((migration) => migration.name),
          });
        }
      }

      const run = await runProbes({
        timeoutMs: config.runtime.readinessProbeTimeoutMs,
      });
      if (isReadyFromProbes(run.probes)) break;

      // Probe details are already redacted by the FND-05.4 registry.
      blocking = run.probes
        .filter((probe) => probe.required && probe.status === "down")
        .map((probe) => (probe.detail ? `${probe.name}: ${probe.detail}` : probe.name))
        .join("; ");
    } catch (error) {
      blocking = safeErrorMessage(error);
    }

    const delayMs = Math.min(maxRetryDelayMs, retryDelayMs * 2 ** (attempts - 1));
    log.warn("Startup blocked; service stays unready and will retry", {
      attempt: attempts,
      delayMs,
      blocking,
    });
    await sleep(delayMs);
  }

  // 6 — declare readiness. markReady() refuses when shutdown began meanwhile,
  // in which case the abort is reported honestly instead of half-starting.
  const ready = readiness.markReady();
  if (!ready) {
    log.warn("Startup aborted before completion", {
      phase: readiness.phase,
      attempts,
    });
    return { config, ready: false, attempts };
  }

  log.info("Startup complete; service is ready", {
    attempts,
    port: config.server.port,
  });

  if (config.runtime.cronEnabled && startCron) {
    try {
      startCron();
    } catch (error) {
      // Cron is not a readiness dependency: a scheduling failure must not take
      // down an otherwise serving instance — but it must be loud.
      log.error("Cron startup failed; service continues without cron", {
        error: safeErrorMessage(error),
      });
    }
  }

  return { config, ready: true, attempts };
}

/* -------------------------------------------------------------------------- */
/* shutdown                                                                    */
/* -------------------------------------------------------------------------- */

export interface HttpCloseResult {
  /** True when the drain deadline passed and connections were force-closed. */
  forced: boolean;
  /** In-flight connections open when the deadline passed — the logged "work". */
  openConnections?: number;
}

export interface ShutdownOptions {
  readiness?: ReadinessState;
  log?: LifecycleLogger;
  /** Defaults to SHUTDOWN_DRAIN_TIMEOUT_MS when the config is loadable. */
  drainTimeoutMs?: number;
  stopCron?: () => void;
  /**
   * Disconnects websocket clients. Runs *before* the HTTP drain: websockets
   * are long-lived by design, so waiting for them to finish would burn the
   * whole drain budget on connections that were never going to close. Clients
   * reconnect after the restart.
   */
  closeWebsockets?: () => void | Promise<void>;
  /** Stops accepting, waits out in-flight requests up to the deadline, then forces. */
  closeHttpServer?: (drainTimeoutMs: number) => Promise<HttpCloseResult>;
  closeRedisConnection?: () => Promise<void>;
  closeDbPool?: () => Promise<void>;
}

let shutdownInFlight: Promise<number> | null = null;

/**
 * Graceful shutdown. Returns the exit code; the entrypoint owns `process.exit`.
 *
 * Idempotent by construction: SIGTERM and SIGINT routinely arrive together
 * (Ctrl-C, then an orchestrator kill), and the second caller joins the first
 * run instead of double-closing pools.
 */
export function shutdown(
  signal: string,
  options: ShutdownOptions = {},
): Promise<number> {
  shutdownInFlight ??= performShutdown(signal, options);
  return shutdownInFlight;
}

async function performShutdown(
  signal: string,
  options: ShutdownOptions,
): Promise<number> {
  const {
    readiness = readinessState,
    log = logger,
    drainTimeoutMs = resolveDrainTimeout(),
    stopCron,
    closeWebsockets,
    closeHttpServer,
    closeRedisConnection = closeRedis,
    closeDbPool = closePool,
  } = options;

  log.info("Shutdown initiated", { signal, drainTimeoutMs });
  let failures = 0;

  // Every step runs even when an earlier one fails: a broken cron stop must
  // not leak the Postgres pool. Failures are logged redacted and reflected in
  // the exit code — faithful reporting, not a claimed-clean exit.
  const step = async (name: string, action?: () => unknown): Promise<unknown> => {
    if (!action) return undefined;
    try {
      return await action();
    } catch (error) {
      failures += 1;
      log.error(`Shutdown step failed: ${name}`, {
        error: safeErrorMessage(error),
      });
      return undefined;
    }
  };

  // 1 — stop advertising. /health/ready reports 503 from this moment, so load
  // balancers route new work elsewhere while in-flight requests complete.
  readiness.markDraining();

  // 2 — no new background work.
  await step("stop cron", stopCron);

  // 3 — kick websockets, then stop accepting and drain in-flight HTTP.
  await step("close websockets", closeWebsockets);

  let forced = false;
  if (closeHttpServer) {
    const result = (await step("close http server", () =>
      closeHttpServer(drainTimeoutMs),
    )) as HttpCloseResult | undefined;

    if (result?.forced) {
      forced = true;
      log.warn("Drain deadline exceeded; force-closing in-flight connections", {
        drainTimeoutMs,
        openConnections: result.openConnections,
      });
    }
  }

  // 5 — release backing connections, consumers before their store: Redis, then
  // the Postgres pool last, since anything above may still flush writes.
  await step("close redis", closeRedisConnection);
  await step("close postgres pool", closeDbPool);

  readiness.markStopped();

  const exitCode = forced || failures > 0 ? 1 : 0;
  log.info("Shutdown complete", { signal, exitCode, forced, failures });
  return exitCode;
}

/**
 * Shutdown can run before configuration ever validated (a SIGTERM during a
 * failed boot), so the drain budget falls back rather than throws.
 */
function resolveDrainTimeout(): number {
  try {
    return getRuntimeConfig().runtime.shutdownDrainTimeoutMs;
  } catch {
    return FALLBACK_DRAIN_TIMEOUT_MS;
  }
}

export function isShutdownInFlight(): boolean {
  return shutdownInFlight !== null;
}

export function resetLifecycleForTests(): void {
  shutdownInFlight = null;
}
