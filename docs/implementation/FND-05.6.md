# FND-05.6 — Startup/shutdown lifecycle and documentation

```yaml
id: FND-05.6
status: complete
contracts_changed:
  - src/observability/health/lifecycle.ts (new; startup()/shutdown() consumed by index.js)
  - src/config/dbConfig.ts (removed process.exit(-1) on idle-client error; added closePool())
migrations: []
tests_run:
  - npm run test:fnd-05.6 (19/19 passed)
  - npm run test:foundation (147 tests; 146 passed, 1 skipped — the FND-03 integration suite without FND_TEST_DATABASE_URL)
  - npm run typecheck
  - explicit tsc pass over test/foundation/lifecycle.unit.test.ts (tsconfig `include` omits test/)
manual_validation:
  - Booted the real index.js against the FND-05.2 compose stack with PostgreSQL deliberately stopped.
    The listener bound immediately; /health/live 200, /health/ready 503, /health/startup 503, and
    application routes answered a gated 503 {"error":"Service is starting"}. The retry loop logged
    "Startup blocked" at 1s/2s/4s/8s/16s capped backoff.
  - Started PostgreSQL; the same process (no restart) connected, auto-applied both pending
    migrations (0001, 0002) to the fresh myra_v2 database, and reached ready in ~15s.
  - Stopped PostgreSQL mid-flight: /health/ready flipped to 503 naming postgres down, /health/live
    stayed 200, /health/startup stayed latched 200, and the process survived — the old dbConfig
    process.exit(-1) would have died here. Restarted PostgreSQL; readiness recovered on its own.
  - SIGTERM produced the ordered drain (draining → cron → websockets → HTTP drain → redis → pool →
    stopped) and logged {"exitCode":0,"forced":false,"failures":0}; the port was released.
  - Scanned the full live-boot log for the DB password, JWT secret, and encryption key: zero
    occurrences; the config summary reports secrets only as set/unset.
known_limitations:
  - The master plan's "shutdown does not leave a half-executed action marked successful" is
    structurally supported (the drain mechanism bounds in-flight work and reports a forced drain as
    exit 1) but cannot be proven here: no write actions exist until CAL-06. Recorded as a known gap,
    not a claimed pass; the action-specific assertion lands with CAL-06.
  - A probe failure whose underlying error has an empty message (Node AggregateError from a refused
    connect) surfaces as detail "postgres: " — dependency name and status are still correct, but the
    detail carries no reason. Cosmetic; sits in the FND-05.4 registry path, flagged rather than
    changed here.
  - FND-05.5's open question stands: defaultProbes marks Chroma required when VECTOR_STORE=chroma,
    while MEM-07 says retrieval should degrade to structured PostgreSQL. Unchanged here.
  - startup()'s retry loop retries deterministic failures (e.g. a migration whose SQL is broken)
    forever at the capped interval. Deliberate: the process stays diagnosable through /health/*
    instead of crash-looping, and the operator sees the same redacted reason on every attempt.
follow_up_packages:
  - FND-06 (baseline tests can now assume /health/* and the documented boot)
  - TOL-03 (flips redis.required; readiness semantics already honor it)
  - CAL-06 (asserts the half-executed-action guarantee on top of the drain mechanism)
```

## New design recorded here

The plan fixed the boot and shutdown order but not these choices:

| Decision | Choice | Rationale |
| --- | --- | --- |
| Dependency failure at boot | Stay unready and retry with capped backoff (1s doubling to 30s) | "Stays unready" that never recovers would demand a restart the moment the dependency returned; the retry loop makes recovery hands-off. Shutdown aborts the loop via the phase check |
| "Serve /health/* only" during boot | A gate middleware in app.js answering 503 until `startupComplete` latches | Application routes would otherwise surface raw driver errors from a not-yet-connected pool. The latch (not the phase) lifts the gate, so draining still serves in-flight traffic |
| Websocket close ordering | Disconnect socket.io clients *before* the HTTP drain, not after it | Deviation from the plan's step order: websockets are long-lived by design, so draining "through" them burns the whole budget on connections that were never going to close. Clients reconnect after restart |
| Cron start failure | Log loudly, stay ready | Cron is not a readiness dependency; killing a serving instance over a scheduler fault inverts the FND-05 goal |
| Exit codes | 0 clean; 1 when the drain was forced **or any close step failed** | The plan named only the forced-drain case; a failed pool close is equally a dirty exit and must not report clean |
| Who calls process.exit | Only index.js; lifecycle returns the code | Keeps startup()/shutdown() assertable in tests, same reasoning as runtimeConfig throwing instead of exiting |

## Enforced boundary

- `startup()` performs config validation before anything observable, registers the probe runner
  before the listener binds, and never marks ready while a required probe is down.
- `shutdown()` is idempotent (a second signal joins the first run), never skips a later step because
  an earlier one failed, and reports every failure in the exit code.
- Every failure path in both directions passes through `safeErrorMessage`; the lifecycle tests
  assert a planted secret cannot reach a log line from either the startup retry loop or a failed
  shutdown step.
