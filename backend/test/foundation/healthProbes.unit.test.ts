/**
 * FND-05.4 — dependency probes.
 *
 * The invariants under test, matching the plan's acceptance criteria:
 *   1. A hung probe times out to `down`; it never hangs the aggregate.
 *   2. A non-required failure leaves the aggregate ready.
 *   3. A pending migration in `verify` mode makes the service not-ready.
 *   4. No probe result — detail or aggregate — contains a secret.
 *
 * Readiness is asserted through `isReadyFromProbes` from `probeContract.ts`,
 * the exact function the FND-05.5 endpoints apply to these results, so these
 * tests exercise the real seam rather than a parallel reimplementation.
 *
 * Every probe runs against injected fakes; no live PostgreSQL, Chroma, or
 * Redis is needed. Live connectivity is exercised once FND-05.2's compose
 * services exist and FND-05.6 registers the runner.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  isReadyFromProbes,
  type ProbeRunResult,
} from "../../src/observability/health/probeContract.js";
import {
  chromaProbe,
  defaultProbes,
  migrationsProbe,
  postgresProbe,
  redisProbe,
  resolveChromaHeartbeat,
} from "../../src/observability/health/probes.js";
import { createProbeRunner, runProbes } from "../../src/observability/health/registry.js";
import type { ProbeDefinition } from "../../src/observability/health/probeTypes.js";
import { loadRuntimeConfig, type RuntimeConfig } from "../../src/config/runtimeConfig.js";
import type { RedisPingResult } from "../../src/config/redisClient.js";

/* -------------------------------------------------------------------------- */
/* fixtures                                                                     */
/* -------------------------------------------------------------------------- */

const okProbe = (name: string, required = true): ProbeDefinition => ({
  name,
  required,
  run: async () => ({ status: "ok" }),
});

const localChromaVector: RuntimeConfig["vector"] = {
  provider: "chroma",
  chromaCloud: false,
  chromaHost: "localhost",
  chromaPort: 58000,
  chromaSsl: false,
  chromaCollection: "myra_chunks_v1",
};

const pgvectorVector: RuntimeConfig["vector"] = {
  ...localChromaVector,
  provider: "pgvector",
};

interface FetchCall {
  url: string;
  headers?: Record<string, string>;
}

/** Fetch stub that records calls and answers with a fixed HTTP status. */
function fakeFetch(status: number) {
  const calls: FetchCall[] = [];
  const impl = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(url), headers: init?.headers });
    return { ok: status >= 200 && status < 300, status } as Response;
  }) as typeof fetch;
  return { impl, calls };
}

const okPing = (latencyMs = 7): (() => Promise<RedisPingResult>) =>
  async () => ({ ok: true, latencyMs });

const failPing: () => Promise<RedisPingResult> = async () => ({
  ok: false,
  latencyMs: 12,
  error: "redis: connection timed out after 300ms",
});

interface MigrationFixture {
  name: string;
  checksum: string;
}

const migrationFiles = (files: MigrationFixture[]) => async () =>
  files.map((file, index) => ({
    version: index + 1,
    name: file.name,
    sql: `SELECT ${index + 1};`,
    checksum: file.checksum,
  }));

const ledgerQuery = (rows: MigrationFixture[]) => async () => ({ rows });

const probeByName = (run: ProbeRunResult, name: string) =>
  run.probes.find((probe) => probe.name === name);

/* -------------------------------------------------------------------------- */
/* registry: parallelism and timeouts                                           */
/* -------------------------------------------------------------------------- */

test("probes run in parallel, not sequentially", async () => {
  // Both probes block on a barrier that opens only once both have started.
  // Sequential execution would deadlock the first probe into its timeout.
  let started = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });

  const blocked = (name: string): ProbeDefinition => ({
    name,
    required: true,
    run: async () => {
      started += 1;
      if (started === 2) release();
      await barrier;
      return { status: "ok" };
    },
  });

  const run = await runProbes([blocked("a"), blocked("b")], { timeoutMs: 500 });

  assert.deepEqual(
    run.probes.map((probe) => probe.status),
    ["ok", "ok"],
    "sequential execution would have timed the first probe out",
  );
});

test("a hung probe yields down instead of hanging the aggregate", async () => {
  const hung: ProbeDefinition = {
    name: "postgres",
    required: true,
    run: () => new Promise(() => {}),
  };

  const startedAt = performance.now();
  const run = await runProbes([hung], { timeoutMs: 50 });

  assert.ok(performance.now() - startedAt < 1_000, "the aggregate must settle promptly");
  assert.equal(run.probes[0].status, "down");
  assert.match(run.probes[0].detail ?? "", /^postgres: probe timed out after 50ms/);
  assert.equal(isReadyFromProbes(run.probes), false);
});

test("a per-probe timeout overrides the run-wide timeout", async () => {
  const hung: ProbeDefinition = {
    name: "slow",
    required: false,
    timeoutMs: 50,
    run: () => new Promise(() => {}),
  };

  const startedAt = performance.now();
  const run = await runProbes([hung], { timeoutMs: 60_000 });

  assert.ok(performance.now() - startedAt < 5_000, "the 50ms override must win");
  assert.equal(run.probes[0].status, "down");
});

test("a throwing probe becomes a named down result, not a rejection", async () => {
  const throwing: ProbeDefinition = {
    name: "chroma",
    required: true,
    run: async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:58000");
    },
  };

  const run = await runProbes([throwing], { timeoutMs: 500 });

  assert.equal(run.probes[0].status, "down");
  assert.match(run.probes[0].detail ?? "", /^chroma: /, "the failing dependency must be named");
  assert.equal(isReadyFromProbes(run.probes), false);
});

test("probe latency is measured and finite", async () => {
  const run = await runProbes([okProbe("postgres")], { timeoutMs: 500 });
  const [result] = run.probes;

  assert.ok(Number.isFinite(result.latencyMs) && result.latencyMs >= 0);
  assert.ok(Number.isFinite(run.durationMs) && run.durationMs >= 0);
});

/* -------------------------------------------------------------------------- */
/* registry: aggregation through the FND-05.5 contract                          */
/* -------------------------------------------------------------------------- */

test("all probes ok yields a ready, ok aggregate", async () => {
  const run = await runProbes([okProbe("postgres"), okProbe("migrations")], { timeoutMs: 500 });

  assert.equal(run.status, "ok");
  assert.equal(isReadyFromProbes(run.probes), true);
});

test("a non-required failure leaves the aggregate ready", async () => {
  const downRedis: ProbeDefinition = {
    name: "redis",
    required: false,
    run: async () => ({ status: "down", detail: "redis: ECONNREFUSED" }),
  };

  const run = await runProbes([okProbe("postgres"), downRedis], { timeoutMs: 500 });

  assert.equal(isReadyFromProbes(run.probes), true, "an optional dependency must not fail readiness");
  assert.equal(run.status, "degraded", "but the impairment must still be visible");
});

test("a required failure makes the aggregate not-ready", async () => {
  const run = await runProbes(
    [okProbe("migrations"), { ...okProbe("postgres"), run: async () => ({ status: "down" as const }) }],
    { timeoutMs: 500 },
  );

  assert.equal(isReadyFromProbes(run.probes), false);
  assert.equal(run.status, "down");
});

test("a degraded required probe does not block readiness", async () => {
  const degraded: ProbeDefinition = {
    name: "migrations",
    required: true,
    run: async () => ({ status: "degraded", detail: "migrations: 1 pending: 0003_x.sql" }),
  };

  const run = await runProbes([degraded], { timeoutMs: 500 });

  assert.equal(isReadyFromProbes(run.probes), true, "degraded means impaired, not unusable");
  assert.equal(run.status, "degraded");
});

test("skipped probes are ignored by the aggregate", async () => {
  const skipped: ProbeDefinition = {
    name: "chroma",
    required: false,
    run: async () => ({ status: "skipped" }),
  };

  const run = await runProbes([okProbe("postgres"), skipped], { timeoutMs: 500 });

  assert.equal(run.status, "ok");
  assert.equal(isReadyFromProbes(run.probes), true);
});

/* -------------------------------------------------------------------------- */
/* registry: redaction                                                          */
/* -------------------------------------------------------------------------- */

test("a secret in a thrown driver error never reaches the probe result", async () => {
  process.env.HEALTH_TEST_DB_PASSWORD = "pr0be-sup3r-secret";
  try {
    const leaking: ProbeDefinition = {
      name: "postgres",
      required: true,
      run: async () => {
        throw new Error(
          'password authentication failed; connection "postgres://myra:pr0be-sup3r-secret@db:5432/myra"',
        );
      },
    };

    const run = await runProbes([leaking], { timeoutMs: 500 });
    const payload = JSON.stringify(run);

    assert.equal(payload.includes("pr0be-sup3r-secret"), false, "the password survived redaction");
    assert.match(run.probes[0].detail ?? "", /^postgres: /);
  } finally {
    delete process.env.HEALTH_TEST_DB_PASSWORD;
  }
});

/* -------------------------------------------------------------------------- */
/* postgres probe                                                               */
/* -------------------------------------------------------------------------- */

test("postgres probe reports ok when SELECT 1 succeeds", async () => {
  const statements: string[] = [];
  const probe = postgresProbe({
    query: async (sql) => {
      statements.push(sql);
      return { rows: [] };
    },
  });

  const run = await runProbes([probe], { timeoutMs: 500 });

  assert.equal(probe.required, true, "postgres is required at every stage");
  assert.equal(run.probes[0].status, "ok");
  assert.deepEqual(statements, ["SELECT 1"]);
});

test("postgres probe failure names the dependency without leaking the DSN password", async () => {
  const probe = postgresProbe({
    query: async () => {
      throw new Error('could not connect to "postgres://myra:pg-p4ssword@localhost:55432/myra"');
    },
  });

  const run = await runProbes([probe], { timeoutMs: 500 });
  const [result] = run.probes;

  assert.equal(result.status, "down");
  assert.equal(isReadyFromProbes(run.probes), false);
  assert.match(result.detail ?? "", /^postgres: /);
  assert.equal(result.detail?.includes("pg-p4ssword"), false, "the URL password survived redaction");
});

/* -------------------------------------------------------------------------- */
/* chroma probe                                                                 */
/* -------------------------------------------------------------------------- */

test("chroma probe is skipped — not down — when pgvector serves retrieval", async () => {
  const { impl, calls } = fakeFetch(200);
  const probe = chromaProbe({ vector: pgvectorVector, fetchImpl: impl });

  const run = await runProbes([probe], { timeoutMs: 500 });

  assert.equal(probe.required, false, "an unused Chroma must not gate readiness");
  assert.equal(run.probes[0].status, "skipped");
  assert.equal(run.probes[0].detail, "not in use: VECTOR_STORE=pgvector");
  assert.equal(isReadyFromProbes(run.probes), true);
  assert.equal(calls.length, 0, "a skipped probe must perform no I/O");
});

test("chroma probe heartbeats the same endpoint the vector store uses", async () => {
  const { impl, calls } = fakeFetch(200);
  const probe = chromaProbe({ vector: localChromaVector, fetchImpl: impl });

  const run = await runProbes([probe], { timeoutMs: 500 });

  assert.equal(probe.required, true, "chroma is required while it serves retrieval");
  assert.equal(run.probes[0].status, "ok");
  assert.deepEqual(calls.map((call) => call.url), ["http://localhost:58000/api/v2/heartbeat"]);
});

test("chroma probe honours CHROMA_SSL for a local server", () => {
  const target = resolveChromaHeartbeat({ ...localChromaVector, chromaSsl: true });
  assert.equal(target.url, "https://localhost:58000/api/v2/heartbeat");
});

test("chroma cloud resolution replaces runtimeConfig's localhost defaults", () => {
  // runtimeConfig defaults CHROMA_HOST/PORT to localhost:8000; with an API key
  // the store actually talks to Chroma Cloud, so the probe must as well.
  const target = resolveChromaHeartbeat({
    ...localChromaVector,
    chromaCloud: true,
    chromaHost: "localhost",
    chromaPort: 8000,
    chromaApiKey: "chroma-cloud-key-123456",
  });

  assert.equal(target.mode, "cloud");
  assert.equal(target.url, "https://api.trychroma.com:443/api/v2/heartbeat");
  assert.deepEqual(target.headers, { "x-chroma-token": "chroma-cloud-key-123456" });
});

test("an explicit cloud host and port are preserved", () => {
  const target = resolveChromaHeartbeat({
    ...localChromaVector,
    chromaCloud: true,
    chromaHost: "eu.trychroma.com",
    chromaPort: 8443,
    chromaApiKey: "chroma-cloud-key-123456",
  });

  assert.equal(target.url, "https://eu.trychroma.com:8443/api/v2/heartbeat");
});

test("a failing heartbeat reports the HTTP status and no credential", async () => {
  const { impl } = fakeFetch(503);
  const probe = chromaProbe({
    vector: { ...localChromaVector, chromaCloud: true, chromaApiKey: "chroma-cloud-key-123456" },
    fetchImpl: impl,
  });

  const run = await runProbes([probe], { timeoutMs: 500 });
  const [result] = run.probes;

  assert.equal(result.status, "down");
  assert.equal(isReadyFromProbes(run.probes), false);
  assert.equal(result.detail, "chroma: heartbeat returned HTTP 503 (cloud)");
  assert.equal(JSON.stringify(run).includes("chroma-cloud-key-123456"), false);
});

test("an unreachable chroma yields a named down result via the registry", async () => {
  const probe = chromaProbe({
    vector: localChromaVector,
    fetchImpl: (async () => {
      throw new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:58000");
    }) as typeof fetch,
  });

  const run = await runProbes([probe], { timeoutMs: 500 });

  assert.equal(run.probes[0].status, "down");
  assert.match(run.probes[0].detail ?? "", /^chroma: /);
});

/* -------------------------------------------------------------------------- */
/* redis probe                                                                  */
/* -------------------------------------------------------------------------- */

test("redis probe reports ok with the ping's own latency", async () => {
  const probe = redisProbe({ required: false, ping: okPing(7) });

  const run = await runProbes([probe], { timeoutMs: 500 });
  const [result] = run.probes;

  assert.equal(result.status, "ok");
  assert.equal(result.latencyMs, 7, "PING times itself; the registry must not overwrite it");
});

test("a redis failure degrades readiness while redis.required is false", async () => {
  const probe = redisProbe({ required: false, ping: failPing });

  const run = await runProbes([okProbe("postgres"), probe], { timeoutMs: 500 });
  const redisResult = probeByName(run, "redis");

  assert.equal(redisResult?.status, "degraded");
  assert.match(redisResult?.detail ?? "", /^redis: /);
  assert.equal(isReadyFromProbes(run.probes), true, "an optional Redis outage must not fail readiness");
  assert.equal(run.status, "degraded");
});

test("the same redis failure becomes down once redis.required flips (TOL-03)", async () => {
  const probe = redisProbe({ required: true, ping: failPing });

  const run = await runProbes([probe], { timeoutMs: 500 });

  assert.equal(run.probes[0].status, "down");
  assert.equal(isReadyFromProbes(run.probes), false);
});

/* -------------------------------------------------------------------------- */
/* migrations probe                                                             */
/* -------------------------------------------------------------------------- */

const APPLIED = [
  { name: "0001_fnd_03_foundation.sql", checksum: "a".repeat(64) },
  { name: "0002_fnd_03_integrity_hardening.sql", checksum: "b".repeat(64) },
];

test("migrations probe reports ok when the ledger matches the repository", async () => {
  const probe = migrationsProbe({
    mode: "verify",
    discover: migrationFiles(APPLIED),
    query: ledgerQuery(APPLIED),
  });

  const run = await runProbes([probe], { timeoutMs: 500 });

  assert.equal(probe.required, true);
  assert.equal(run.probes[0].status, "ok");
});

test("a pending migration in verify mode makes the service not-ready", async () => {
  const pendingFile = { name: "0003_tol_02.sql", checksum: "c".repeat(64) };
  const probe = migrationsProbe({
    mode: "verify",
    discover: migrationFiles([...APPLIED, pendingFile]),
    query: ledgerQuery(APPLIED),
  });

  const run = await runProbes([probe], { timeoutMs: 500 });
  const [result] = run.probes;

  assert.equal(result.status, "down");
  assert.equal(isReadyFromProbes(run.probes), false, "verify mode must refuse readiness on drift");
  assert.match(result.detail ?? "", /2 applied, 1 pending: 0003_tol_02\.sql/);
});

test("a pending migration in auto mode degrades instead — boot will apply it", async () => {
  const pendingFile = { name: "0003_tol_02.sql", checksum: "c".repeat(64) };
  const probe = migrationsProbe({
    mode: "auto",
    discover: migrationFiles([...APPLIED, pendingFile]),
    query: ledgerQuery(APPLIED),
  });

  const run = await runProbes([probe], { timeoutMs: 500 });

  assert.equal(run.probes[0].status, "degraded");
  assert.equal(isReadyFromProbes(run.probes), true);
});

test("a checksum mismatch is down in any mode — history is immutable", async () => {
  const probe = migrationsProbe({
    mode: "auto",
    discover: migrationFiles([APPLIED[0], { ...APPLIED[1], checksum: "f".repeat(64) }]),
    query: ledgerQuery(APPLIED),
  });

  const run = await runProbes([probe], { timeoutMs: 500 });
  const [result] = run.probes;

  assert.equal(result.status, "down");
  assert.equal(isReadyFromProbes(run.probes), false);
  assert.match(result.detail ?? "", /checksum mismatch for 0002_fnd_03_integrity_hardening\.sql/);
});

test("an applied migration vanishing from the repository is down", async () => {
  const probe = migrationsProbe({
    mode: "auto",
    discover: migrationFiles([APPLIED[0]]),
    query: ledgerQuery(APPLIED),
  });

  const run = await runProbes([probe], { timeoutMs: 500 });
  const [result] = run.probes;

  assert.equal(result.status, "down");
  assert.match(result.detail ?? "", /missing from the repository: 0002_fnd_03_integrity_hardening\.sql/);
});

test("a fresh database with no ledger treats every migration as pending", async () => {
  const probe = migrationsProbe({
    mode: "verify",
    discover: migrationFiles(APPLIED),
    query: async () => {
      throw Object.assign(new Error('relation "schema_migrations" does not exist'), {
        code: "42P01",
      });
    },
  });

  const run = await runProbes([probe], { timeoutMs: 500 });
  const [result] = run.probes;

  assert.equal(result.status, "down");
  assert.match(result.detail ?? "", /0 applied, 2 pending/);
});

test("any other ledger error is a named, redacted down result", async () => {
  const probe = migrationsProbe({
    mode: "verify",
    discover: migrationFiles(APPLIED),
    query: async () => {
      throw new Error('no pg_hba.conf entry for "postgres://myra:mig-p4ssword@db:5432/myra"');
    },
  });

  const run = await runProbes([probe], { timeoutMs: 500 });
  const [result] = run.probes;

  assert.equal(result.status, "down");
  assert.match(result.detail ?? "", /^migrations: /);
  assert.equal(result.detail?.includes("mig-p4ssword"), false, "the URL password survived redaction");
});

/* -------------------------------------------------------------------------- */
/* probe runner port (consumed by FND-05.5 via setProbeRunner in FND-05.6)      */
/* -------------------------------------------------------------------------- */

test("createProbeRunner satisfies the contract: reports status, never rejects", async () => {
  const runner = createProbeRunner([
    okProbe("postgres"),
    {
      name: "chroma",
      required: true,
      run: async () => {
        throw new Error("ECONNREFUSED");
      },
    },
  ]);

  const run = await runner();

  assert.equal(run.status, "down");
  assert.deepEqual(run.probes.map((probe) => probe.name), ["postgres", "chroma"]);
});

test("createProbeRunner applies the caller's timeout over its bound default", async () => {
  const hung: ProbeDefinition = {
    name: "postgres",
    required: true,
    run: () => new Promise(() => {}),
  };
  const runner = createProbeRunner([hung], { timeoutMs: 60_000 });

  const startedAt = performance.now();
  const run = await runner({ timeoutMs: 50 });

  assert.ok(performance.now() - startedAt < 5_000, "the router's timeout must win");
  assert.match(run.probes[0].detail ?? "", /timed out after 50ms/);
});

/* -------------------------------------------------------------------------- */
/* standard set                                                                 */
/* -------------------------------------------------------------------------- */

test("defaultProbes wires the four FND-05 probes to the validated config", () => {
  const config = loadRuntimeConfig({
    DB_HOST: "localhost",
    DB_PORT: "55432",
    DB_NAME: "myra",
    DB_USER: "myra",
    DB_PASSWORD: "local-dev-password",
    JWT_SECRET: "local-dev-jwt-secret",
    TOKEN_ENCRYPTION_KEY: "local-dev-encryption-key",
    VECTOR_STORE: "chroma",
    READINESS_PROBE_TIMEOUT_MS: "1500",
  });

  const probes = defaultProbes(config);

  assert.deepEqual(
    probes.map((probe) => probe.name),
    ["postgres", "chroma", "redis", "migrations"],
  );
  assert.deepEqual(
    probes.map((probe) => probe.required),
    [true, true, false, true],
    "postgres and migrations always gate readiness; redis not until TOL-03",
  );
  assert.ok(
    probes.every((probe) => probe.timeoutMs === 1500),
    "every probe must run inside READINESS_PROBE_TIMEOUT_MS",
  );
});

test("defaultProbes marks chroma optional when pgvector serves retrieval", () => {
  const config = loadRuntimeConfig({
    DB_HOST: "localhost",
    DB_PORT: "55432",
    DB_NAME: "myra",
    DB_USER: "myra",
    DB_PASSWORD: "local-dev-password",
    JWT_SECRET: "local-dev-jwt-secret",
    TOKEN_ENCRYPTION_KEY: "local-dev-encryption-key",
    VECTOR_STORE: "pgvector",
  });

  const chroma = defaultProbes(config).find((probe) => probe.name === "chroma");

  assert.equal(chroma?.required, false);
});
