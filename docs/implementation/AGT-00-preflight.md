# AGT-00 — Day 2 pre-flight (P0)

```yaml
id: AGT-00-preflight
status: complete
contracts_changed:
  - src/config/runtimeConfig.ts (new `agents` and `tools` blocks on RuntimeConfig and
    RuntimeConfigSummary; 20 new environment variables, all defaulted)
  - src/config/redaction.ts (isSecretEnvName no longer classifies *_MAX_TOKENS as a secret;
    collectSecretValues no longer harvests numeric values as redaction patterns)
  - tsconfig.v2.json (src/api/**/*.ts added to the strict project, for AGT-07)
  - package.json (pinned @langchain/langgraph and @langchain/langgraph-checkpoint-postgres;
    new scripts test:agt-p0 and test:agt-p0:db; test:foundation now serialized)
migrations:
  - 0003_agt_02_langgraph_checkpoints.sql
tests_run:
  - npm run test:agt-p0 (39/39 passed)
  - FND_TEST_DATABASE_URL=postgresql://localhost/myra_fnd_test npm run test:agt-p0:db (4/4 passed)
  - npm run test:foundation (164 tests, 162 passed, 2 skipped — without a database)
  - FND_TEST_DATABASE_URL=... npm run test:foundation (171/171 passed, run twice to prove
    the suite is repeatable against a database it has already mutated)
  - npm run test:fnd-07 (32/32 passed)
  - npm run test:fnd-06 (140/140 passed)
  - npm run test:fnd-01, npm run test:fnd-02 (passed)
  - npm run typecheck:v2, npm run typecheck, npm run typecheck:baseline, npm run build (clean)
manual_validation:
  - Loaded the developer's real .env through the extended validator and printed
    describeRuntimeConfig. Every AGENT_*/TOOL_* variable defaulted correctly against an .env that
    names none of them, and agents.enabled came back false.
  - Compiled and invoked a real LangGraph StateGraph with a checkpointer under tsx + NodeNext, to
    prove the new dependency works in this repository's module resolution rather than only
    installing.
  - Proved the checkpoint-schema parity test rejects real drift, not only synthetic cases. Four
    mutations of 0003, each reverted afterwards: dropping a column from `checkpoints` (2 tests
    red), adding an index the library does not create (1 red), recording one migration version too
    few (1 red), and staling the pinned version comment (1 red). Back to 6/6 after each revert,
    with the file byte-identical to the original.
known_limitations:
  - The checkpointer schema is verified against the pinned library by text parity plus a live
    setup() no-op check. Neither can see a change the library makes to its *queries* without
    changing its DDL; that would surface as a failing AGT-02 resume test, not here.
  - The parity test reads the library's dist/migrations.js by file URL because the package's
    export map does not expose it. That indirection is test-only and will need a touch if the
    package restructures its build output.
  - No boot of the full application: Docker was not running, so Chroma and Redis were unavailable.
    PostgreSQL work was verified against a local PostgreSQL 17 (`myra_fnd_test`, left in place —
    the FND-03 suite uses the same database).
  - `test:foundation` is now serialized (--test-concurrency=1). Two suites in that directory reset
    the same database, and node:test runs files in parallel by default; the unit files in the same
    glob pay a small time cost for that.
  - P0-5 is only half-landed by design: the flag is validated and defaults to false, and app.js
    carries the mount-point note, but nothing is mounted until AGT-07 exists.
follow_up_packages:
  - AGT-01 (state and reducers) — unblocked, starts next
  - AGT-02 (run lifecycle and checkpointing) — consumes 0003 and agents.checkpointing
  - AGT-05 (budgets) — consumes agents.budgets and agents.loops verbatim
  - TOL-02 (gateway) — consumes tools.defaultTimeoutMs and tools.maxResultBytes
  - AGT-07 (run API) — mounts /agent behind agents.enabled at the marked point in app.js
```

## What was created

| Item | Where | Why |
| --- | --- | --- |
| LangGraph runtime | `package.json` (exact-pinned `@langchain/langgraph@1.4.9`) | Day 2 has no runtime without it; the version is pinned because the checkpointer DDL is version-coupled |
| Checkpointer | `package.json` (exact-pinned `@langchain/langgraph-checkpoint-postgres@1.0.4`) | Durable execution, interrupts, recovery (plan §15.3) |
| Owned checkpoint schema | `0003_agt_02_langgraph_checkpoints.sql` | The library's `setup()` cannot be the schema author under forward-only migrations |
| Parity guard | `test/foundation/langgraphCheckpointSchema.unit.test.ts` | A library upgrade that changes the DDL must fail the build, not a production resume |
| Live no-op proof | `test/foundation/langgraphCheckpointSchema.integration.test.ts` | Text parity cannot prove `setup()` actually finds nothing to do |
| Agent config surface | `src/config/runtimeConfig.ts` | §9.4: "These values must be configuration, not hard-coded business logic" |
| Strict scope for the run API | `tsconfig.v2.json` | AGT-07 turns a request principal into the `userId` every tenant check depends on |

## New design recorded here

| Decision | Choice | Rationale |
| --- | --- | --- |
| Checkpoint schema ownership | Migration 0003 creates the tables in a dedicated `langgraph` schema and pre-records the library's migration versions 0–4 | `setup()` then has nothing to do, so exactly one component authors the schema. Forward-only migrations and `verify` mode in production both forbid a process creating tables at boot |
| Faithful mirror, no additions | No extra index, constraint, or column — not even an obviously useful one | A checkpoint table that differs from what the library's SQL expects is a silent resume failure. Additions also make "zero diff" unassertable, and the assertion is the whole guard |
| Isolation above the checkpointer | Recorded in the migration, the README, and a test that fails if `user_id` ever appears there | Adding `user_id` to these tables looks like a fix and is not: the library writes the rows and knows nothing about MyRA users. It would advertise a boundary that does not exist |
| Loop bounds are ceilings | `AGENT_MAX_REPLAN_ITERATIONS` ≤ 3 and `AGENT_MAX_VERIFICATION_RETRIES` ≤ 2 are enforced by validation; everything else is a default | §8.6 and diagram 01 state these as rules, not starting values. An operator able to raise them could defeat AGT-05's termination guarantee from an .env file |
| Budgets mirrored by hand | `agents.budgets` matches `RunBudgetLimitsSchema` field for field, without importing it | `src/config` is shared infrastructure. Importing a V2 module boundary from underneath it would invert the layering FND-07 exists to protect |
| Checkpoint schema name is configuration | `LANGGRAPH_CHECKPOINT_SCHEMA` | Two components must agree on it — the migration that creates the tables and the checkpointer that queries them. A literal in both is a literal that drifts |
| Agent runtime off by default | `AGENT_RUNTIME_ENABLED=false`, asserted by test | A default of true would ship an unreviewed runtime to anyone who upgrades without reading a changelog |

## Two defects found and fixed on the way

**`AGENT_MAX_TOKENS` was classified as a secret.** `isSecretEnvName` matches `TOKEN` as a
substring, which is right for `TOKEN_ENCRYPTION_KEY` and wrong for a model-token budget. The
consequence was not a leak but corruption: `collectSecretValues` would have harvested `120000` and
`redactText` would have replaced every occurrence of that number in every downstream error message.
Fixed in two layers — a narrow, anchored `*_MAX_TOKENS` exception, and a general rule that a bare
numeric value is never used as a redaction pattern, since a credential is never a bare number. Both
are covered by new tests. Model-token budgets will keep arriving, so the collision is now handled
once rather than rediscovered.

**Two foundation suites raced over one database.** `foundationPersistence.integration.test.ts` and
the new checkpoint suite both `DROP SCHEMA public CASCADE` in `before`, and node:test runs test
files in parallel. `test:foundation` is now serialized. The same suite also asserted its migration
list as two frozen literals, which made every future migration a test edit; both now derive the
expected list from `discoverMigrations()`, so the assertion still checks an exact ordered list
without needing to be rewritten each time.
