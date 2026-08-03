/**
 * FND-05.6 — startup/shutdown lifecycle.
 *
 * The invariants under test:
 *   1. Boot follows the documented order: config → probe registration →
 *      listener → Postgres → migrations → probes → ready.
 *   2. An unavailable required dependency leaves the process reachable but
 *      unready, retrying with capped backoff — it recovers without a restart.
 *   3. Migrations apply on boot only in `auto` mode.
 *   4. Shutdown drains in order, is idempotent, reports a forced drain or a
 *      failed step as exit code 1, and never skips later steps because an
 *      earlier one failed.
 *   5. No failure path leaks a secret into a log line.
 *
 * No live service and no environment are required: every effect is injected.
 * Configs are built through the real `loadRuntimeConfig` so shapes cannot
 * drift from the validator.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  resetLifecycleForTests,
  shutdown,
  startup,
  type HttpCloseResult,
  type LifecycleLogger,
  type ShutdownOptions,
  type StartupOptions,
} from "../../src/observability/health/lifecycle.js";
import {
  ConfigValidationError,
  loadRuntimeConfig,
  type RuntimeConfig,
} from "../../src/config/runtimeConfig.js";
import {
  getProbeRunner,
  resetProbeRunnerForTests,
} from "../../src/observability/health/probeRegistration.js";
import type {
  ProbeResult,
  ProbeRunResult,
  ProbeRunner,
} from "../../src/observability/health/probeContract.js";
import { ReadinessState } from "../../src/observability/health/readinessState.js";

afterEach(() => {
  resetLifecycleForTests();
  resetProbeRunnerForTests();
});

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

const BASE_ENV = Object.freeze({
  NODE_ENV: "development",
  DB_HOST: "localhost",
  DB_PORT: "55432",
  DB_NAME: "myra_v2",
  DB_USER: "myra",
  DB_PASSWORD: "unit-test-password",
  JWT_SECRET: "unit-test-jwt-secret",
  TOKEN_ENCRYPTION_KEY: "unit-test-encryption-key",
});

function makeConfig(overrides: Record<string, string> = {}): RuntimeConfig {
  return loadRuntimeConfig({ ...BASE_ENV, ...overrides });
}

function probe(overrides: Partial<ProbeResult> & { name: string }): ProbeResult {
  return { status: "ok", required: true, latencyMs: 1, ...overrides };
}

function probeRun(probes: ProbeResult[]): ProbeRunResult {
  return {
    status: probes.some((p) => p.required && p.status === "down") ? "down" : "ok",
    probes,
    durationMs: 1,
  };
}

const ALL_OK = probeRun([probe({ name: "postgres" }), probe({ name: "migrations" })]);
const POSTGRES_DOWN = probeRun([
  probe({ name: "postgres", status: "down", detail: "postgres: connection refused" }),
  probe({ name: "migrations" }),
]);

interface LogLine {
  level: "info" | "warn" | "error";
  message: string;
  context?: Record<string, unknown>;
}

function makeLog(): { log: LifecycleLogger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  return {
    lines,
    log: {
      info: (message, context) => lines.push({ level: "info", message, context }),
      warn: (message, context) => lines.push({ level: "warn", message, context }),
      error: (message, context) => lines.push({ level: "error", message, context }),
    },
  };
}

/** Startup options where every effect records itself and succeeds. */
function makeStartupHarness(
  config: RuntimeConfig,
  overrides: Partial<StartupOptions> = {},
): { options: StartupOptions; calls: string[]; readiness: ReadinessState; lines: LogLine[] } {
  const calls: string[] = [];
  const readiness = new ReadinessState();
  const { log, lines } = makeLog();

  const options: StartupOptions = {
    loadConfig: () => {
      calls.push("loadConfig");
      return config;
    },
    readiness,
    log,
    bindListener: async () => {
      calls.push("bindListener");
    },
    connectPostgres: async () => {
      calls.push("connectPostgres");
    },
    applyMigrations: async () => {
      calls.push("applyMigrations");
      return { applied: [], skipped: [] };
    },
    buildProbeRunner: () => async () => {
      calls.push("runProbes");
      return ALL_OK;
    },
    registerProbeRunner: () => {
      calls.push("registerProbeRunner");
    },
    startCron: () => {
      calls.push("startCron");
    },
    sleep: async () => {
      calls.push("sleep");
    },
    ...overrides,
  };

  return { options, calls, readiness, lines };
}

/** Shutdown options where every step records itself and succeeds. */
function makeShutdownHarness(overrides: Partial<ShutdownOptions> = {}): {
  options: ShutdownOptions;
  calls: string[];
  readiness: ReadinessState;
  lines: LogLine[];
} {
  const calls: string[] = [];
  const readiness = new ReadinessState();
  readiness.markReady();
  const { log, lines } = makeLog();

  const options: ShutdownOptions = {
    readiness,
    log,
    drainTimeoutMs: 500,
    stopCron: () => {
      calls.push("stopCron");
    },
    closeWebsockets: () => {
      calls.push("closeWebsockets");
    },
    closeHttpServer: async (): Promise<HttpCloseResult> => {
      calls.push("closeHttpServer");
      return { forced: false, openConnections: 0 };
    },
    closeRedisConnection: async () => {
      calls.push("closeRedis");
    },
    closeDbPool: async () => {
      calls.push("closePool");
    },
    ...overrides,
  };

  return { options, calls, readiness, lines };
}

/* -------------------------------------------------------------------------- */
/* startup                                                                     */
/* -------------------------------------------------------------------------- */

test("startup runs the documented boot order and reaches ready", async () => {
  const { options, calls, readiness } = makeStartupHarness(makeConfig());

  const result = await startup(options);

  assert.deepEqual(calls, [
    "loadConfig",
    "registerProbeRunner",
    "bindListener",
    "connectPostgres",
    "applyMigrations",
    "runProbes",
    "startCron",
  ]);
  assert.equal(result.ready, true);
  assert.equal(result.attempts, 1);
  assert.equal(readiness.phase, "ready");
  assert.equal(readiness.startupComplete, true);
});

test("startup registers the real probe runner by default", async () => {
  const { options } = makeStartupHarness(makeConfig(), {
    // Let the default registration path run; keep probes fake.
    registerProbeRunner: undefined,
  });

  assert.equal(getProbeRunner(), null);
  await startup(options);
  assert.notEqual(getProbeRunner(), null);
});

test("startup skips applying migrations outside auto mode", async () => {
  const { options, calls } = makeStartupHarness(
    makeConfig({ NODE_ENV: "test" }), // defaults migrationsOnBoot to "verify"
  );

  const result = await startup(options);

  assert.equal(result.ready, true);
  assert.ok(!calls.includes("applyMigrations"));
  assert.ok(calls.includes("runProbes"));
});

test("startup hands the configured timeout to the probe runner", async () => {
  const seen: Array<number | undefined> = [];
  const { options } = makeStartupHarness(
    makeConfig({ READINESS_PROBE_TIMEOUT_MS: "1234" }),
    {
      buildProbeRunner: (): ProbeRunner => async (probeOptions) => {
        seen.push(probeOptions?.timeoutMs);
        return ALL_OK;
      },
    },
  );

  await startup(options);
  assert.deepEqual(seen, [1234]);
});

test("a required dependency down leaves the service unready, then retries to ready", async () => {
  const delays: number[] = [];
  let probeAttempts = 0;

  const { options, readiness, lines } = makeStartupHarness(makeConfig(), {
    buildProbeRunner: (): ProbeRunner => async () => {
      probeAttempts += 1;
      return probeAttempts < 4 ? POSTGRES_DOWN : ALL_OK;
    },
    sleep: async (ms) => {
      delays.push(ms);
      // Mid-boot the process must be alive but not accepting traffic.
      assert.equal(readiness.phase, "starting");
      assert.equal(readiness.acceptsTraffic, false);
      assert.equal(readiness.alive, true);
    },
  });

  const result = await startup(options);

  assert.equal(result.ready, true);
  assert.equal(result.attempts, 4);
  // Capped exponential backoff: 1s, 2s, 4s.
  assert.deepEqual(delays, [1000, 2000, 4000]);
  assert.equal(readiness.phase, "ready");

  const blocked = lines.filter((line) =>
    line.message.includes("Startup blocked"),
  );
  assert.equal(blocked.length, 3);
  // The retry log names the blocking dependency.
  assert.match(String(blocked[0].context?.blocking), /postgres/);
});

test("startup backoff is capped at maxRetryDelayMs", async () => {
  const delays: number[] = [];
  let probeAttempts = 0;

  const { options } = makeStartupHarness(makeConfig(), {
    retryDelayMs: 1000,
    maxRetryDelayMs: 3000,
    buildProbeRunner: (): ProbeRunner => async () => {
      probeAttempts += 1;
      return probeAttempts < 6 ? POSTGRES_DOWN : ALL_OK;
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  await startup(options);
  assert.deepEqual(delays, [1000, 2000, 3000, 3000, 3000]);
});

test("a thrown dependency error is logged redacted, never verbatim", async () => {
  const secret = "hunter2-super-secret-value";
  process.env.LIFECYCLE_TEST_SECRET = secret;

  try {
    let connectAttempts = 0;
    const { options, lines } = makeStartupHarness(makeConfig(), {
      connectPostgres: async () => {
        connectAttempts += 1;
        if (connectAttempts === 1) {
          throw new Error(`connection to ${secret} refused`);
        }
      },
    });

    const result = await startup(options);
    assert.equal(result.ready, true);

    const blocked = lines.find((line) => line.message.includes("Startup blocked"));
    assert.ok(blocked, "expected a retry log line");
    const blocking = String(blocked.context?.blocking);
    assert.ok(!blocking.includes(secret), "secret leaked into the startup log");
    assert.match(blocking, /\[redacted\]/);
  } finally {
    delete process.env.LIFECYCLE_TEST_SECRET;
  }
});

test("shutdown during the retry loop aborts startup without reaching ready", async () => {
  const { options, calls, readiness } = makeStartupHarness(makeConfig(), {
    buildProbeRunner: (): ProbeRunner => async () => POSTGRES_DOWN,
    sleep: async () => {
      // SIGTERM arrives while boot is still retrying.
      readiness.markDraining();
    },
  });

  const result = await startup(options);

  assert.equal(result.ready, false);
  assert.equal(readiness.phase, "draining");
  assert.equal(readiness.startupComplete, false);
  assert.ok(!calls.includes("startCron"), "an aborted boot must not start cron");
});

test("invalid configuration rejects before anything binds", async () => {
  const { options, calls } = makeStartupHarness(makeConfig(), {
    loadConfig: () => loadRuntimeConfig({}), // throws: everything missing
  });

  await assert.rejects(() => startup(options), ConfigValidationError);
  assert.ok(!calls.includes("bindListener"));
  assert.ok(!calls.includes("connectPostgres"));
});

test("a failed listener bind rejects startup — nothing can report health", async () => {
  const { options, readiness } = makeStartupHarness(makeConfig(), {
    bindListener: async () => {
      throw new Error("listen EADDRINUSE");
    },
  });

  await assert.rejects(() => startup(options), /EADDRINUSE/);
  assert.equal(readiness.phase, "starting");
  assert.equal(readiness.startupComplete, false);
});

test("cron does not start when disabled, and a cron failure does not unready the service", async () => {
  const disabled = makeStartupHarness(makeConfig({ ENABLE_CRON_JOBS: "false" }));
  await startup(disabled.options);
  assert.ok(!disabled.calls.includes("startCron"));

  resetLifecycleForTests();
  resetProbeRunnerForTests();

  const failing = makeStartupHarness(makeConfig(), {
    startCron: () => {
      throw new Error("node-cron exploded");
    },
  });
  const result = await startup(failing.options);

  assert.equal(result.ready, true);
  assert.equal(failing.readiness.phase, "ready");
  const cronError = failing.lines.find((line) => line.level === "error");
  assert.ok(cronError, "cron failure must be logged");
  assert.match(cronError.message, /Cron startup failed/);
});

/* -------------------------------------------------------------------------- */
/* shutdown                                                                    */
/* -------------------------------------------------------------------------- */

test("shutdown drains in the documented order and exits 0", async () => {
  const { options, calls, readiness } = makeShutdownHarness();

  const exitCode = await shutdown("SIGTERM", options);

  assert.deepEqual(calls, [
    "stopCron",
    "closeWebsockets",
    "closeHttpServer",
    "closeRedis",
    "closePool",
  ]);
  assert.equal(exitCode, 0);
  assert.equal(readiness.phase, "stopped");
});

test("draining stops advertising readiness before any step runs", async () => {
  const { options, readiness } = makeShutdownHarness({
    stopCron: () => {
      // By the first step, /health/ready must already be refusing traffic.
      assert.equal(readiness.phase, "draining");
      assert.equal(readiness.acceptsTraffic, false);
      assert.equal(readiness.alive, true);
    },
  });

  await shutdown("SIGTERM", options);
});

test("the drain deadline reaches closeHttpServer", async () => {
  const seen: number[] = [];
  const { options } = makeShutdownHarness({
    drainTimeoutMs: 4321,
    closeHttpServer: async (ms) => {
      seen.push(ms);
      return { forced: false };
    },
  });

  await shutdown("SIGTERM", options);
  assert.deepEqual(seen, [4321]);
});

test("a forced drain logs the in-flight work and exits 1", async () => {
  const { options, lines, readiness } = makeShutdownHarness({
    closeHttpServer: async () => ({ forced: true, openConnections: 7 }),
  });

  const exitCode = await shutdown("SIGTERM", options);

  assert.equal(exitCode, 1);
  assert.equal(readiness.phase, "stopped");
  const warned = lines.find((line) => line.message.includes("Drain deadline exceeded"));
  assert.ok(warned, "expected the forced-drain warning");
  assert.equal(warned.context?.openConnections, 7);
});

test("shutdown is idempotent: a second signal joins the first run", async () => {
  const { options, calls } = makeShutdownHarness();

  const [first, second] = await Promise.all([
    shutdown("SIGTERM", options),
    shutdown("SIGINT", options),
  ]);

  assert.equal(first, 0);
  assert.equal(second, 0);
  // Every step ran exactly once.
  assert.equal(calls.filter((name) => name === "closePool").length, 1);
  assert.equal(calls.filter((name) => name === "closeHttpServer").length, 1);
});

test("a failing step is logged redacted, later steps still run, exit is 1", async () => {
  const secret = "redis-password-abcdef";
  process.env.LIFECYCLE_TEST_SECRET = secret;

  try {
    const { options, calls, lines, readiness } = makeShutdownHarness({
      closeRedisConnection: async () => {
        throw new Error(`AUTH failed for ${secret}`);
      },
    });

    const exitCode = await shutdown("SIGTERM", options);

    assert.equal(exitCode, 1);
    // The pool still closed and the process still reached stopped.
    assert.ok(calls.includes("closePool"));
    assert.equal(readiness.phase, "stopped");

    const failure = lines.find((line) => line.message.includes("close redis"));
    assert.ok(failure, "expected the failed-step log");
    const detail = String(failure.context?.error);
    assert.ok(!detail.includes(secret), "secret leaked into the shutdown log");
    assert.match(detail, /\[redacted\]/);
  } finally {
    delete process.env.LIFECYCLE_TEST_SECRET;
  }
});

test("shutdown with nothing wired still resolves and marks stopped", async () => {
  const readiness = new ReadinessState();
  const { log } = makeLog();

  const exitCode = await shutdown("SIGINT", {
    readiness,
    log,
    drainTimeoutMs: 100,
    // Redis/pool defaults are safe against never-connected clients, but the
    // point here is the shape: no optional step, no crash.
    closeRedisConnection: async () => {},
    closeDbPool: async () => {},
  });

  assert.equal(exitCode, 0);
  assert.equal(readiness.phase, "stopped");
});

test("a SIGTERM during a failed boot still shuts down cleanly from starting", async () => {
  const readiness = new ReadinessState();
  assert.equal(readiness.phase, "starting");

  const { options } = makeShutdownHarness({ readiness });
  // makeShutdownHarness marked ready on its own instance; this one is fresh.
  const exitCode = await shutdown("SIGTERM", { ...options, readiness });

  assert.equal(exitCode, 0);
  assert.equal(readiness.phase, "stopped");
});
