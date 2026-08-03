/**
 * FND-05.5 — health endpoints and readiness state.
 *
 * The invariants under test:
 *   1. Liveness never touches a dependency, so an outage cannot cause a restart loop.
 *   2. Readiness is the conjunction of lifecycle phase and required-probe health.
 *   3. `draining` is terminal-ward — a late startup completion cannot re-advertise readiness.
 *   4. The unauthenticated response carries no secret and no production detail.
 *   5. Health checking cannot become its own source of load.
 *
 * No live Postgres, Chroma, or Redis is required: the probe runner is injected.
 * Requests go over real HTTP against an ephemeral port using the global fetch in
 * Node 22, because supertest is not a dependency of this project.
 */

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";

import { createHealthRouter } from "../../src/api/routes/health.js";
import {
  aggregateProbeStatus,
  isReadyFromProbes,
  type ProbeResult,
  type ProbeRunResult,
  type ProbeRunner,
} from "../../src/observability/health/probeContract.js";
import {
  getProbeRunner,
  resetProbeRunnerForTests,
  setProbeRunner,
} from "../../src/observability/health/probeRegistration.js";
import { missingRequiredProbes } from "../../src/observability/health/probeContract.js";
import { ReadinessState } from "../../src/observability/health/readinessState.js";

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

function probe(overrides: Partial<ProbeResult> & { name: string }): ProbeResult {
  return { status: "ok", required: true, latencyMs: 1, ...overrides };
}

function probeRun(probes: ProbeResult[]): ProbeRunResult {
  return { status: aggregateProbeStatus(probes), probes, durationMs: 5 };
}

const HEALTHY = probeRun([
  probe({ name: "postgres" }),
  probe({ name: "migrations" }),
  probe({ name: "chroma", status: "skipped", required: false }),
  probe({ name: "redis", status: "ok", required: false }),
]);

interface Harness {
  url: string;
  readiness: ReadinessState;
  calls: () => number;
  close: () => Promise<void>;
}

/** Mount the router on a real server so status codes and headers are exercised. */
async function startHarness(
  options: {
    runProbes?: ProbeRunner | null;
    result?: ProbeRunResult;
    exposeDetail?: boolean;
    cacheTtlMs?: number;
    readiness?: ReadinessState;
    probeTimeoutMs?: number;
    deadlineMs?: number;
    /** Leave the runner unset so the router falls through to the module registry. */
    useRegistry?: boolean;
  } = {},
): Promise<Harness> {
  const readiness = options.readiness ?? new ReadinessState();
  let calls = 0;

  const runProbes: ProbeRunner | null | undefined = options.useRegistry
    ? undefined
    : options.runProbes !== undefined
      ? options.runProbes
      : async () => {
        calls += 1;
        return options.result ?? HEALTHY;
      };

  const app = express();
  app.use(
    "/health",
    createHealthRouter({
      runProbes,
      readiness,
      exposeDetail: options.exposeDetail ?? true,
      cacheTtlMs: options.cacheTtlMs ?? 0,
      probeTimeoutMs: options.probeTimeoutMs ?? 500,
      deadlineMs: options.deadlineMs,
    }),
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    readiness,
    calls: () => calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Shape of a health response body, loose enough to assert on absent fields. */
interface HealthBody {
  status: string;
  phase: string;
  uptimeMs: number;
  checkedAt: string;
  dependencies?: Array<{
    name: string;
    status: string;
    required: boolean;
    latencyMs: number;
    detail?: string;
  }>;
}

async function get(
  harness: Harness,
  path: string,
): Promise<{ status: number; headers: Headers; body: HealthBody }> {
  const response = await fetch(`${harness.url}${path}`);
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as HealthBody,
  };
}

/* -------------------------------------------------------------------------- */
/* pure readiness rules                                                        */
/* -------------------------------------------------------------------------- */

test("only a required probe that is down blocks readiness", () => {
  assert.equal(isReadyFromProbes([probe({ name: "postgres", status: "down" })]), false);
  assert.equal(
    isReadyFromProbes([probe({ name: "redis", status: "down", required: false })]),
    true,
    "an optional dependency must not remove the instance from rotation",
  );
  assert.equal(
    isReadyFromProbes([probe({ name: "postgres", status: "degraded" })]),
    true,
    "a slow required dependency still serves; pulling capacity would worsen the incident",
  );
});

test("aggregate status distinguishes skipped from degraded", () => {
  assert.equal(
    aggregateProbeStatus([probe({ name: "chroma", status: "skipped", required: false })]),
    "ok",
    "a dependency that is not in use cannot degrade the service",
  );
  assert.equal(
    aggregateProbeStatus([probe({ name: "redis", status: "down", required: false })]),
    "degraded",
  );
  assert.equal(aggregateProbeStatus([probe({ name: "postgres", status: "down" })]), "down");
  assert.equal(aggregateProbeStatus([]), "ok");
});

/* -------------------------------------------------------------------------- */
/* lifecycle state machine                                                     */
/* -------------------------------------------------------------------------- */

test("a fresh process starts in `starting` and does not accept traffic", () => {
  const state = new ReadinessState();

  assert.equal(state.phase, "starting");
  assert.equal(state.acceptsTraffic, false);
  assert.equal(state.alive, true, "a booting process must not be restarted");
  assert.equal(state.startupComplete, false);
});

test("draining can never transition back to ready", () => {
  const state = new ReadinessState();
  state.markReady();
  state.markDraining();

  // Startup work is asynchronous; a probe finishing after SIGTERM must not
  // re-advertise an instance that is about to stop serving.
  assert.equal(state.markReady(), false, "the illegal transition must be refused");
  assert.equal(state.phase, "draining");
  assert.equal(state.acceptsTraffic, false);
});

test("stopped is terminal", () => {
  const state = new ReadinessState();
  state.markStopped();

  assert.equal(state.markReady(), false);
  assert.equal(state.markDraining(), false);
  assert.equal(state.phase, "stopped");
  assert.equal(state.alive, false);
});

test("startup completion latches and survives draining", () => {
  const state = new ReadinessState();
  state.markReady();
  assert.equal(state.startupComplete, true);

  state.markDraining();
  assert.equal(state.startupComplete, true, "a drain does not un-complete startup");
});

test("a repeated transition is a no-op, not an error", () => {
  const state = new ReadinessState();
  assert.equal(state.markReady(), true);
  assert.equal(state.markReady(), false, "idempotent: shutdown paths may call twice");
});

test("uptime advances with the injected clock", () => {
  let now = 1_000;
  const state = new ReadinessState({ now: () => now });
  now = 4_500;

  assert.equal(state.snapshot().uptimeMs, 3_500);
});

/* -------------------------------------------------------------------------- */
/* liveness                                                                    */
/* -------------------------------------------------------------------------- */

test("liveness stays 200 while every dependency is down", async () => {
  const harness = await startHarness({
    result: probeRun([probe({ name: "postgres", status: "down" })]),
  });
  harness.readiness.markReady();

  try {
    const response = await get(harness, "/health/live");

    // The whole point of the split: restarting cannot fix a database outage,
    // so liveness must not fail because of one.
    assert.equal(response.status, 200);
    assert.equal(response.body.status, "ok");
  } finally {
    await harness.close();
  }
});

test("liveness never invokes the probe runner", async () => {
  const harness = await startHarness();
  harness.readiness.markReady();

  try {
    await get(harness, "/health/live");
    assert.equal(harness.calls(), 0, "liveness must perform no I/O");

    const response = await get(harness, "/health/live");
    assert.equal(response.body.dependencies, undefined, "liveness reports no dependencies");
  } finally {
    await harness.close();
  }
});

test("liveness fails only once the process has stopped", async () => {
  const harness = await startHarness();
  harness.readiness.markReady();
  harness.readiness.markStopped();

  try {
    const response = await get(harness, "/health/live");
    assert.equal(response.status, 503);
    assert.equal(response.body.phase, "stopped");
  } finally {
    await harness.close();
  }
});

/* -------------------------------------------------------------------------- */
/* readiness                                                                   */
/* -------------------------------------------------------------------------- */

test("readiness is 503 while starting, without probing", async () => {
  const harness = await startHarness();

  try {
    const response = await get(harness, "/health/ready");

    assert.equal(response.status, 503);
    assert.equal(response.body.phase, "starting");
    assert.equal(harness.calls(), 0, "phase short-circuits the probe run");
  } finally {
    await harness.close();
  }
});

test("readiness is 200 once ready and all required probes pass", async () => {
  const harness = await startHarness();
  harness.readiness.markReady();

  try {
    const response = await get(harness, "/health/ready");

    assert.equal(response.status, 200);
    assert.equal(response.body.status, "ok");
    assert.equal(response.body.dependencies!.length, 4);
    assert.deepEqual(
      response.body.dependencies!.map((d) => d.name).sort(),
      ["chroma", "migrations", "postgres", "redis"],
    );
  } finally {
    await harness.close();
  }
});

test("a down required dependency makes the instance unready", async () => {
  const harness = await startHarness({
    result: probeRun([
      probe({ name: "postgres", status: "down", detail: "connection refused" }),
      probe({ name: "migrations" }),
    ]),
  });
  harness.readiness.markReady();

  try {
    const response = await get(harness, "/health/ready");

    assert.equal(response.status, 503);
    assert.equal(response.body.status, "down");
    const postgres = response.body.dependencies!.find(
      (d) => d.name === "postgres",
    );
    assert.equal(postgres.status, "down");
  } finally {
    await harness.close();
  }
});

test("a down optional dependency serves traffic as degraded", async () => {
  const harness = await startHarness({
    result: probeRun([
      probe({ name: "postgres" }),
      probe({ name: "migrations" }),
      probe({ name: "redis", status: "down", required: false }),
    ]),
  });
  harness.readiness.markReady();

  try {
    const response = await get(harness, "/health/ready");

    // Redis is unused until TOL-03, so its outage is reportable but not fatal.
    assert.equal(response.status, 200);
    assert.equal(response.body.status, "degraded");
  } finally {
    await harness.close();
  }
});

test("a pending migration keeps the instance unready", async () => {
  const harness = await startHarness({
    result: probeRun([
      probe({ name: "postgres" }),
      probe({ name: "migrations", status: "down", detail: "1 pending migration" }),
    ]),
  });
  harness.readiness.markReady();

  try {
    assert.equal((await get(harness, "/health/ready")).status, 503);
  } finally {
    await harness.close();
  }
});

test("readiness is 503 while draining even when dependencies are healthy", async () => {
  const harness = await startHarness();
  harness.readiness.markReady();
  harness.readiness.markDraining();

  try {
    const response = await get(harness, "/health/ready");

    assert.equal(response.status, 503);
    assert.equal(response.body.phase, "draining");
    assert.equal(harness.calls(), 0, "probing during shutdown only delays the drain");
  } finally {
    await harness.close();
  }
});

test("an unregistered probe runner fails closed and names the reason", async () => {
  const harness = await startHarness({ runProbes: null });
  harness.readiness.markReady();

  try {
    const response = await get(harness, "/health/ready");

    // A wiring bug must not ship as a permanently green readiness endpoint.
    assert.equal(response.status, 503);
    assert.match(response.body.dependencies![0].detail, /not registered/);
  } finally {
    await harness.close();
  }
});

test("a probe runner that rejects yields 503, not a 500", async () => {
  const harness = await startHarness({
    runProbes: async () => {
      throw new Error("registry exploded");
    },
  });
  harness.readiness.markReady();

  try {
    const response = await get(harness, "/health/ready");

    assert.equal(response.status, 503, "the health endpoint must not crash on a bad runner");
    assert.equal(response.body.status, "down");
  } finally {
    await harness.close();
  }
});

/* -------------------------------------------------------------------------- */
/* startup                                                                     */
/* -------------------------------------------------------------------------- */

test("startup is 503 before boot completes and 200 afterwards", async () => {
  const harness = await startHarness();

  try {
    assert.equal((await get(harness, "/health/startup")).status, 503);

    harness.readiness.markReady();
    assert.equal((await get(harness, "/health/startup")).status, 200);

    harness.readiness.markDraining();
    assert.equal(
      (await get(harness, "/health/startup")).status,
      200,
      "startup stays complete for the rest of the process lifetime",
    );
  } finally {
    await harness.close();
  }
});

test("startup performs no I/O", async () => {
  const harness = await startHarness();
  harness.readiness.markReady();

  try {
    await get(harness, "/health/startup");
    assert.equal(harness.calls(), 0);
  } finally {
    await harness.close();
  }
});

/* -------------------------------------------------------------------------- */
/* information disclosure                                                      */
/* -------------------------------------------------------------------------- */

test("probe detail is suppressed when detail exposure is off", async () => {
  const harness = await startHarness({
    exposeDetail: false,
    result: probeRun([
      probe({
        name: "postgres",
        status: "down",
        detail: "connect ECONNREFUSED postgres://myra_app@10.0.0.7:5432/myra",
      }),
    ]),
  });
  harness.readiness.markReady();

  try {
    const response = await get(harness, "/health/ready");
    const serialized = JSON.stringify(response.body);

    // These endpoints are unauthenticated; internal topology must not leak.
    assert.equal(response.body.dependencies![0].detail, undefined);
    assert.equal(serialized.includes("10.0.0.7"), false);
    assert.equal(serialized.includes("ECONNREFUSED"), false);
    assert.equal(
      response.body.dependencies![0].status,
      "down",
      "status must still be reported so the outage is visible",
    );
  } finally {
    await harness.close();
  }
});

test("no health response carries a credential", async () => {
  const harness = await startHarness({
    exposeDetail: true,
    result: probeRun([
      probe({ name: "postgres", status: "down", detail: "redis: auth failed" }),
    ]),
  });
  harness.readiness.markReady();

  try {
    for (const path of ["/health/live", "/health/ready", "/health/startup"]) {
      const serialized = JSON.stringify((await get(harness, path)).body);
      assert.equal(serialized.includes("sup3r"), false);
      assert.equal(serialized.includes("password"), false);
    }
  } finally {
    await harness.close();
  }
});

test("health responses forbid caching", async () => {
  const harness = await startHarness();
  harness.readiness.markReady();

  try {
    for (const path of ["/health/live", "/health/ready", "/health/startup"]) {
      const response = await get(harness, path);
      // A cached 200 would keep routing traffic to an instance that has since
      // started draining.
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    }
  } finally {
    await harness.close();
  }
});

/* -------------------------------------------------------------------------- */
/* probe load                                                                  */
/* -------------------------------------------------------------------------- */

test("concurrent readiness requests share a single probe run", async () => {
  let started = 0;
  const harness = await startHarness({
    cacheTtlMs: 0,
    runProbes: async () => {
      started += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return HEALTHY;
    },
  });
  harness.readiness.markReady();

  try {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => get(harness, "/health/ready")),
    );

    // A load balancer, an orchestrator, and a dashboard can poll at once.
    // Without single-flight, each poll opens its own dependency connections —
    // health checking becoming a load source exactly when the system is sick.
    assert.equal(started, 1, `expected one probe run, got ${started}`);
    for (const response of responses) assert.equal(response.status, 200);
  } finally {
    await harness.close();
  }
});

test("a recent probe result is reused within the cache window", async () => {
  const harness = await startHarness({ cacheTtlMs: 60_000 });
  harness.readiness.markReady();

  try {
    await get(harness, "/health/ready");
    await get(harness, "/health/ready");
    await get(harness, "/health/ready");

    assert.equal(harness.calls(), 1, "polling must not multiply dependency load");
  } finally {
    await harness.close();
  }
});

test("probe results are re-run once the cache window elapses", async () => {
  const harness = await startHarness({ cacheTtlMs: 20 });
  harness.readiness.markReady();

  try {
    await get(harness, "/health/ready");
    await new Promise((resolve) => setTimeout(resolve, 40));
    await get(harness, "/health/ready");

    assert.equal(harness.calls(), 2, "a stale result must not be served indefinitely");
  } finally {
    await harness.close();
  }
});

/* -------------------------------------------------------------------------- */
/* registration                                                                */
/* -------------------------------------------------------------------------- */

test("the probe runner registry is settable and resettable", () => {
  resetProbeRunnerForTests();
  assert.equal(getProbeRunner(), null, "fail closed until FND-05.6 wires the registry");

  const runner: ProbeRunner = async () => HEALTHY;
  setProbeRunner(runner);
  assert.equal(getProbeRunner(), runner);

  resetProbeRunnerForTests();
  assert.equal(getProbeRunner(), null);
});

test("the router resolves the registered runner at request time", async () => {
  // app.js mounts the router at import time, before FND-05.6 registers the
  // real registry, so resolution must be deferred to the request.
  resetProbeRunnerForTests();
  const harness = await startHarness({ useRegistry: true });
  harness.readiness.markReady();

  try {
    assert.equal((await get(harness, "/health/ready")).status, 503);

    setProbeRunner(async () => HEALTHY);
    assert.equal(
      (await get(harness, "/health/ready")).status,
      200,
      "registering later must take effect without remounting",
    );
  } finally {
    resetProbeRunnerForTests();
    await harness.close();
  }
});

/* -------------------------------------------------------------------------- */
/* runner containment                                                          */
/* -------------------------------------------------------------------------- */

test("a runner that never settles cannot hang the endpoint", async () => {
  // probeTimeoutMs is the PER-PROBE budget handed to the registry. Whether the
  // registry honours it is an assumption this module cannot make, so readiness
  // enforces its own outer bound.
  const harness = await startHarness({
    runProbes: () => new Promise<ProbeRunResult>(() => {}),
    deadlineMs: 80,
  });
  harness.readiness.markReady();

  try {
    const response = await get(harness, "/health/ready");

    assert.equal(response.status, 503);
    assert.equal(response.body.status, "down");
    assert.match(response.body.dependencies![0].detail ?? "", /deadline/);
  } finally {
    await harness.close();
  }
});

test("an abandoned run does not wedge every later request", async () => {
  // The abandoned promise must not stay parked in the single-flight slot, or
  // the first hung probe makes readiness permanently unanswerable.
  let release: (value: ProbeRunResult) => void = () => {};
  let started = 0;

  const harness = await startHarness({
    deadlineMs: 60,
    runProbes: () => {
      started += 1;
      return started === 1
        ? new Promise<ProbeRunResult>((resolve) => {
          release = resolve;
        })
        : Promise.resolve(HEALTHY);
    },
  });
  harness.readiness.markReady();

  try {
    assert.equal((await get(harness, "/health/ready")).status, 503, "first request hits the deadline");

    const second = await get(harness, "/health/ready");
    assert.equal(started, 2, "the slot must be free for a fresh run");
    assert.equal(second.status, 200);
  } finally {
    release(HEALTHY);
    await harness.close();
  }
});

test("a run slower than the cache window still populates the cache", async () => {
  // Stamping the entry at run START makes it already stale whenever the run
  // outlasts the TTL, so the stampede guard vanishes exactly when probes are
  // slow — during the outage it exists to protect against.
  let runs = 0;
  const harness = await startHarness({
    cacheTtlMs: 100,
    runProbes: async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 120));
      return HEALTHY;
    },
  });
  harness.readiness.markReady();

  try {
    for (let i = 0; i < 3; i += 1) await get(harness, "/health/ready");
    assert.equal(runs, 1, `expected one probe run, got ${runs}`);
  } finally {
    await harness.close();
  }
});

/* -------------------------------------------------------------------------- */
/* required-probe presence                                                     */
/* -------------------------------------------------------------------------- */

test("an empty probe set is not ready", async () => {
  // isReadyFromProbes asks "did anything fail?", which an empty set answers
  // with "no". A registry that registers nothing would otherwise read green.
  const harness = await startHarness({
    result: { status: "ok", probes: [], durationMs: 1 },
  });
  harness.readiness.markReady();

  try {
    const response = await get(harness, "/health/ready");

    assert.equal(response.status, 503);
    assert.equal(response.body.status, "down");
    assert.match(response.body.dependencies!.at(-1)!.detail ?? "", /postgres.*migrations|migrations.*postgres/);
  } finally {
    await harness.close();
  }
});

test("a run that silently drops postgres is not ready", async () => {
  const harness = await startHarness({
    result: probeRun([probe({ name: "migrations" }), probe({ name: "redis", required: false })]),
  });
  harness.readiness.markReady();

  try {
    const response = await get(harness, "/health/ready");

    assert.equal(response.status, 503, "a missing required probe must not read as healthy");
    assert.match(response.body.dependencies!.at(-1)!.detail ?? "", /postgres/);
  } finally {
    await harness.close();
  }
});

test("missingRequiredProbes names only what is absent", () => {
  assert.deepEqual(missingRequiredProbes([]), ["postgres", "migrations"]);
  assert.deepEqual(missingRequiredProbes([probe({ name: "postgres" })]), ["migrations"]);
  assert.deepEqual(
    missingRequiredProbes([probe({ name: "postgres" }), probe({ name: "migrations" })]),
    [],
  );
  assert.deepEqual(
    missingRequiredProbes([
      probe({ name: "postgres", status: "down" }),
      probe({ name: "migrations" }),
    ]),
    [],
    "presence is independent of status",
  );
});

test("the missing-probe reason is suppressed in production", async () => {
  const harness = await startHarness({
    exposeDetail: false,
    result: { status: "ok", probes: [], durationMs: 1 },
  });
  harness.readiness.markReady();

  try {
    const response = await get(harness, "/health/ready");

    assert.equal(response.status, 503, "the verdict is still reported");
    assert.equal(response.body.dependencies!.at(-1)!.detail, undefined);
  } finally {
    await harness.close();
  }
});
