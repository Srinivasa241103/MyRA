/**
 * FND-05.3 — Redis client.
 *
 * The invariants under test:
 *   1. Building the client performs no I/O.
 *   2. A connection failure never terminates the process and never hangs.
 *   3. Teardown is idempotent and safe on a client that never connected.
 *   4. No secret reaches a Redis diagnostic.
 *
 * These run without a Redis server. Live connectivity is covered by the
 * readiness probe in FND-05.4 once local services exist.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReconnectStrategy,
  closeRedis,
  connectRedis,
  createErrorLogThrottle,
  createRedisClient,
  getRedis,
  isRedisConnected,
  pingRedis,
  resetRedisForTests,
} from "../../src/config/redisClient.js";

/** A port nothing listens on, so connection attempts fail fast and predictably. */
const DEAD_REDIS_URL = "redis://127.0.0.1:56999";
const SHORT_TIMEOUT_MS = 300;

const CLIENT_OPTIONS = {
  url: DEAD_REDIS_URL,
  connectTimeoutMs: SHORT_TIMEOUT_MS,
  reconnect: { baseDelayMs: 10, maxDelayMs: 20 },
};

test.afterEach(() => {
  resetRedisForTests();
});

/* -------------------------------------------------------------------------- */
/* backoff                                                                     */
/* -------------------------------------------------------------------------- */

test("reconnect delay grows exponentially and is capped", () => {
  const strategy = buildReconnectStrategy({
    baseDelayMs: 100,
    maxDelayMs: 5_000,
    jitterRatio: 0,
  });

  assert.equal(strategy(0), 100);
  assert.equal(strategy(1), 200);
  assert.equal(strategy(2), 400);
  assert.equal(strategy(3), 800);
  assert.equal(strategy(10), 5_000, "must saturate at the ceiling");
  assert.equal(strategy(100), 5_000, "a long outage settles at a steady poll");
});

test("reconnect delay stays non-negative and finite at extreme retry counts", () => {
  const strategy = buildReconnectStrategy({ baseDelayMs: 100, maxDelayMs: 5_000 });

  // 2 ** 5000 overflows to Infinity; the exponent clamp prevents NaN delays.
  for (const retries of [0, 1, 50, 5_000, Number.MAX_SAFE_INTEGER]) {
    const delay = strategy(retries);
    assert.ok(Number.isFinite(delay), `delay for ${retries} retries must be finite`);
    assert.ok(delay >= 0, `delay for ${retries} retries must be non-negative`);
    assert.ok(delay <= 6_000, "jitter must not push the delay far past the cap");
  }
});

test("negative retry counts are treated as the first attempt", () => {
  const strategy = buildReconnectStrategy({ baseDelayMs: 100, maxDelayMs: 5_000, jitterRatio: 0 });
  assert.equal(strategy(-5), 100);
});

test("jitter spreads reconnects around the capped delay", () => {
  const atFloor = buildReconnectStrategy({
    baseDelayMs: 1_000,
    maxDelayMs: 1_000,
    jitterRatio: 0.2,
    random: () => 0,
  });
  const atCeiling = buildReconnectStrategy({
    baseDelayMs: 1_000,
    maxDelayMs: 1_000,
    jitterRatio: 0.2,
    random: () => 1,
  });

  assert.equal(atFloor(5), 800, "random()=0 maps to the low end of the jitter band");
  assert.equal(atCeiling(5), 1_200, "random()=1 maps to the high end");
});

/* -------------------------------------------------------------------------- */
/* error log throttling                                                        */
/* -------------------------------------------------------------------------- */

test("a repeated error logs once per interval, not once per retry", () => {
  let now = 0;
  const shouldLog = createErrorLogThrottle(30_000, () => now);

  assert.equal(shouldLog("redis: ECONNREFUSED"), true, "first occurrence always logs");
  assert.equal(shouldLog("redis: ECONNREFUSED"), false);

  now = 29_999;
  assert.equal(shouldLog("redis: ECONNREFUSED"), false, "still inside the interval");

  now = 30_000;
  assert.equal(shouldLog("redis: ECONNREFUSED"), true, "interval elapsed");
});

test("a different error logs immediately regardless of the interval", () => {
  let now = 0;
  const shouldLog = createErrorLogThrottle(30_000, () => now);

  assert.equal(shouldLog("redis: ECONNREFUSED"), true);
  now = 10;
  assert.equal(shouldLog("redis: ETIMEDOUT"), true, "a new failure mode must not be suppressed");
});

/* -------------------------------------------------------------------------- */
/* lazy construction                                                           */
/* -------------------------------------------------------------------------- */

test("building a client performs no I/O", () => {
  const instance = createRedisClient(CLIENT_OPTIONS);

  assert.equal(instance.isOpen, false, "createClient must not dial the server");
  assert.equal(instance.isReady, false);
});

test("getRedis returns the same lazily built instance", () => {
  const first = getRedis(CLIENT_OPTIONS);
  const second = getRedis(CLIENT_OPTIONS);

  assert.equal(first, second, "the shared client must be a singleton");
  assert.equal(isRedisConnected(), false, "no connection until connectRedis is called");
});

test("resetRedisForTests clears the singleton", () => {
  const first = getRedis(CLIENT_OPTIONS);
  resetRedisForTests();
  const second = getRedis(CLIENT_OPTIONS);

  assert.notEqual(first, second);
});

test("an error event does not crash the process", () => {
  const instance = createRedisClient(CLIENT_OPTIONS);

  // node-redis emits `error` on an EventEmitter. With no listener attached,
  // Node treats it as an unhandled error event and terminates the process.
  assert.ok(instance.listenerCount("error") > 0, "an error listener must be attached at build time");
  assert.doesNotThrow(() => instance.emit("error", new Error("simulated outage")));
});

/* -------------------------------------------------------------------------- */
/* connection failure                                                          */
/* -------------------------------------------------------------------------- */

test("connecting to an unreachable server rejects instead of hanging", async () => {
  // The reconnect strategy retries forever, so an unbounded connect() would
  // never settle and would stall both startup and the readiness endpoint.
  const startedAt = performance.now();

  await assert.rejects(
    () => connectRedis(CLIENT_OPTIONS),
    (error: Error) => {
      assert.match(error.message, /^redis: /, "the failing dependency must be named");
      return true;
    },
  );

  const elapsed = performance.now() - startedAt;
  assert.ok(elapsed < 5_000, `connect must be bounded; took ${Math.round(elapsed)}ms`);
});

test("a failed connect clears the singleton so a later attempt starts clean", async () => {
  const first = getRedis(CLIENT_OPTIONS);
  await assert.rejects(() => connectRedis(CLIENT_OPTIONS));

  const second = getRedis(CLIENT_OPTIONS);
  assert.notEqual(first, second, "a client stuck retrying must not be reused");
});

test("pingRedis reports failure rather than throwing", async () => {
  // A probe reports status; it never propagates failure to its caller.
  const result = await pingRedis(CLIENT_OPTIONS);

  assert.equal(result.ok, false);
  assert.ok(typeof result.error === "string" && result.error.length > 0);
  assert.match(result.error, /^redis: /);
  assert.ok(Number.isFinite(result.latencyMs) && result.latencyMs >= 0);
});

test("redis credentials never appear in a failure message", async () => {
  const result = await pingRedis({
    ...CLIENT_OPTIONS,
    url: "redis://admin:r3dis-p4ssword@127.0.0.1:56999",
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.error?.includes("r3dis-p4ssword"),
    false,
    "the URL password survived redaction",
  );
});

/* -------------------------------------------------------------------------- */
/* teardown                                                                    */
/* -------------------------------------------------------------------------- */

test("closeRedis is safe when Redis was never used", async () => {
  // FND-05.6 calls this unconditionally during shutdown.
  await assert.doesNotReject(() => closeRedis());
});

test("closeRedis is safe on a client that never connected", async () => {
  getRedis(CLIENT_OPTIONS);
  // quit() throws ClientClosedError in this state; close must fall back to destroy.
  await assert.doesNotReject(() => closeRedis());
  assert.equal(isRedisConnected(), false);
});

test("closeRedis is idempotent", async () => {
  getRedis(CLIENT_OPTIONS);

  await closeRedis();
  await assert.doesNotReject(() => closeRedis(), "a second shutdown signal must be harmless");
});

test("closeRedis releases the singleton", async () => {
  const first = getRedis(CLIENT_OPTIONS);
  await closeRedis();

  assert.notEqual(getRedis(CLIENT_OPTIONS), first);
});
