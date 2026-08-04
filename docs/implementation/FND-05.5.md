# FND-05.5 — Health endpoints and readiness state

```yaml
id: FND-05.5
status: complete
contracts_changed:
  - src/observability/health/probeContract.ts (new; port consumed by FND-05.4)
migrations: []
tests_run:
  - npm run test:fnd-05.5 (36/36 passed)
  - npm run test:foundation (128 tests; 127 passed, 1 skipped — the FND-03 integration suite without FND_TEST_DATABASE_URL)
  - npm run typecheck
  - explicit tsc pass over test/foundation/healthEndpoints.integration.test.ts (tsconfig `include` omits test/)
  - manual live check against the real app.js on an ephemeral port
  - manual seam check composing the real FND-05.4 registry through setProbeRunner into /health/ready
manual_validation:
  - Confirmed /health/live, /health/ready, /health/startup mount on the real app and return the documented codes across starting, ready, and draining.
  - Confirmed GET / still returns "API is running..." and GET /stats/all still returns the 401 non-disclosing denial after the mount.
  - Confirmed an unregistered probe runner fails closed (503) rather than reporting a green readiness endpoint.
  - Confirmed a degraded optional dependency (Redis down) serves traffic as 200/degraded.
  - Confirmed the FND-05.4 seam end to end against live services: createProbeRunner(defaultProbes(config)) registered via setProbeRunner produced HTTP 200 / aggregate degraded, with postgres ok 202ms, chroma ok 769ms, redis ok 37ms, and migrations degraded reporting 2 pending files in auto mode.
known_limitations:
  - dbConfig.ts still calls process.exit(-1) on a pool error, so the process can die on a transient PostgreSQL blip before readiness can report it. Queued for FND-05.6.
  - Nothing calls setProbeRunner() during boot yet, so the mounted endpoint reports 503 "probe runner not registered" until FND-05.6 wires it. The wiring was verified manually but is not yet in index.js.
  - FND-05.4's defaultProbes marks Chroma `required: true` when VECTOR_STORE=chroma, so a Chroma outage currently blocks readiness. MEM-07 specifies that retrieval degrades to structured PostgreSQL when Chroma is unavailable, which suggests Chroma should be optional. Raised against FND-05.4 rather than changed here.
  - No HTTP rate limiting sits in front of these unauthenticated endpoints; the project has no rate limiter at all. Probe load is bounded (single-flight plus TTL) but request volume is not.
  - The master plan's "shutdown does not leave a half-executed action marked successful" is untouched here; it binds to the write-action state machine and cannot be validated before TOL-03 and CAL-06.
follow_up_packages:
  - FND-05.4
  - FND-05.6
  - TOL-03
```

## New design recorded here

The master plan specifies only "liveness plus readiness checks for PostgreSQL, Chroma, Redis, and
migrations". Endpoint paths, status codes, response shape, and the degraded-serves-traffic rule are
**not** in the plan. Per the plan's own rule (§1: record a change before code and design diverge),
they are recorded here and an ADR is owed:

| Decision | Choice | Rationale |
| --- | --- | --- |
| Paths | `/health/live`, `/health/ready`, `/health/startup` | `/health/ready` was already named in a committed code comment (`src/config/redaction.ts`) |
| Auth | Unauthenticated | Orchestrators and load balancers cannot present a token |
| Codes | 200 healthy, 503 otherwise | Standard probe semantics; no 4xx, since the caller is never at fault |
| Body | `{status, phase, uptimeMs, checkedAt, dependencies[]}` | Not the `{success, data}` envelope — health is a machine surface, not an API response |
| Required + `degraded` | Still ready | Removing capacity for slowness concentrates load and worsens the incident |
| Optional + `down` | Ready, reported `degraded` | Redis is `required: false` until TOL-03 |
| `skipped` ≠ `degraded` | Distinct statuses | Chroma under `VECTOR_STORE=pgvector` is not a fault |
| Probe reuse | Single-flight + 1s TTL | Prevents health checking becoming a load source |
| Unregistered runner | Fail closed | A wiring bug must not ship as a permanently green endpoint |
| Outer run deadline | `probeTimeoutMs + 500ms` | `probeTimeoutMs` is the per-probe budget *handed to* the registry; honouring it is an assumption this module cannot make |
| Empty probe set | Not ready | `isReadyFromProbes([])` is `true` — "did anything fail?" has no failures to find |

## Defects found and fixed during review

Three were reproduced against the first implementation before being fixed, each with a
regression test:

| Defect | Symptom measured | Fix |
| --- | --- | --- |
| No outer bound on the probe run | A runner returning a never-settling promise left `/health/ready` with **no response at all**, and the pending promise parked in the single-flight slot made every later request hang too | Race the run against `deadlineMs`, resolving (never rejecting) to a `down` result; release the slot on the deadline path so the next request starts fresh; `unref()` the timer |
| Cache stamped at run **start** | With `cacheTtlMs=100` and a 120ms run, the entry was stale the instant it was written — 3 sequential requests produced 3 probe runs, so the stampede guard vanished exactly when probes are slow | Stamp at completion; the abandoned run still warms the cache |
| Fail-open on an empty probe set | A run with zero probes returned **HTTP 200 / ok** — a registry that registers nothing, or silently drops PostgreSQL, would read as fully healthy | `missingRequiredProbes()` gate over `EXPECTED_REQUIRED_PROBES = ["postgres", "migrations"]`, applied by the router; `isReadyFromProbes` stays pure because FND-05.4 calls it with partial fixture sets at seven sites |

The presence gate also caught a stale fixture in this package's own suite: the
optional-dependency test omitted `migrations`, and now asserts a complete run.

## Enforced boundary

- `/health/live` performs no I/O and never consults a dependency. A test asserts the injected probe
  runner is called zero times, so a dependency outage cannot produce a restart loop.
- `/health/ready` is the conjunction of lifecycle phase and probe health: `phase === "ready"` **and**
  no required probe is `down`. Phase is evaluated first and short-circuits the probe run.
- `draining` is terminal-ward. `LEGAL_TRANSITIONS` has no `draining → ready` edge, so a startup step
  completing after SIGTERM cannot re-advertise an instance that is about to stop serving.
- `/health/startup` latches on completion and stays 200 for the remaining process lifetime.
- Probe detail strings are omitted entirely when `NODE_ENV=production`; dependency **name** and
  **status** are always reported, satisfying the plan's requirement to name the unavailable
  dependency without leaking credentials.
- All three responses set `Cache-Control: no-store`, so a cached 200 cannot keep routing traffic to
  a draining instance.
- A probe runner that rejects — a breach of its own contract — is caught and reported as `down`
  rather than surfacing as a 500.

## Files

| Path | Action |
| --- | --- |
| `backend/src/observability/health/probeContract.ts` | new — port, `isReadyFromProbes`, `aggregateProbeStatus` |
| `backend/src/observability/health/readinessState.ts` | new — validated lifecycle phase machine |
| `backend/src/observability/health/probeRegistration.ts` | new — deferred runner registration, fail-closed default |
| `backend/src/api/routes/health.ts` | new — the three endpoints |
| `backend/src/app.js` | edit — mount `/health` ahead of the application routes |
| `backend/test/foundation/healthEndpoints.integration.test.ts` | new — 29 tests |
| `backend/package.json` | edit — `test:fnd-05.5` |

## Validation evidence

`backend/test/foundation/healthEndpoints.integration.test.ts` covers the pure readiness rules, the
lifecycle transition table including the refused `draining → ready` edge, liveness independence from
dependencies, readiness across starting/ready/draining, required vs optional probe failure, pending
migrations, an unregistered runner, a rejecting runner, startup latching, detail suppression,
`no-store`, single-flight collapsing eight concurrent requests into one probe run, TTL reuse, and
TTL expiry.

## Deviation from house test style

Existing route tests call handlers directly with an object-literal `req` and a local
`responseRecorder()` fake, because supertest is not a dependency. This suite instead mounts the
router on `app.listen(0)` and drives it with the global `fetch` in Node 22. It adds no dependency
and additionally exercises real routing, status codes, and response headers — `Cache-Control` and
the 503 codes cannot be verified through a `responseRecorder` fake. Flagged rather than adopted
silently; revert to the fake-`res` style if the divergence is unwanted.
