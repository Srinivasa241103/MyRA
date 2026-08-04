# FND-06 — Freeze current behavior with baseline tests

```yaml
id: FND-06
status: complete
contracts_changed:
  - src/RAG/retrieval/personResolver.ts (new exported `PersonResolverLike`; `PersonResolver` unchanged)
  - src/RAG/retrieval/retrievalPlanner.ts (`ResolvedRetrievalPlanInput.resolver` widened from the
    nominal `PersonResolver` class to `PersonResolverLike` — type-only, no runtime change)
  - src/RAG/retrieval/retriever.ts (new optional `personResolver` dependency, undefined in
    production so the planner keeps its own default)
  - src/RAG/ingestion/ingestionPipeline.js (constructor now takes optional
    `{ syncRepo, documentRepo, sources }`; defaults are exactly the previous hard-wired values)
  - tsconfig.test.json (new; no-emit project so the baseline suite compiles under the same options)
  - package.json (new scripts: test:fnd-06, test:baseline, typecheck:baseline)
migrations: []
tests_run:
  - npm run test:fnd-06 (140/140 passed — 8 baseline files)
  - npm run typecheck:baseline (clean)
  - npm run typecheck (clean)
  - npm run build (clean)
  - npm run test:foundation (147 tests; 146 passed, 1 skipped — the FND-03 integration suite
    without FND_TEST_DATABASE_URL)
  - npm run test:fnd-01, npm run test:fnd-02 (both passed)
manual_validation:
  - Ran the whole baseline suite with no services running: no PostgreSQL, no Chroma, no Redis, no
    Google credentials, no LLM key. 140/140 still pass, so the net can gate a commit rather than
    only a fully-provisioned laptop.
  - Verified the net bites rather than merely passing. mutationGuards.baseline.test.ts is the
    permanent form of that check (24 cases), and it was confirmed by hand first: dropping the
    `{ user_id: String(userId) }` condition from `buildWhere` in chromaVectorStore.ts turned
    "every Chroma search filters by user, schema version, and source" red, and deleting
    `sender_email` from `buildSourceMetadata` in vectorRecordMapper.ts turned "a Gmail chunk maps
    to a user-namespaced, source-tagged record" red. Both files were restored afterwards; the
    guards reproduce the same failures without touching production code.
  - Confirmed the leak case end to end through the real Retriever: a vector store that ignores its
    `userId` argument still returns well-formed chunks and still produces a successful outcome —
    only `assertResultsBelongToUser` fails. That is the mutation the baseline exists for.
known_limitations:
  - The suite is unit and contract level by construction: it freezes the seams, not a live stack.
    Real PostgreSQL/Chroma round-trips stay with FND-03's integration suite (needs
    FND_TEST_DATABASE_URL) and FND-04's isolation suite. FND-06 does not replace either.
  - Rerank is asserted only on the pass-through path. The LLM-reranked ordering is nondeterministic
    and belongs to QLT-01's evaluation harness, not to a regression gate.
  - `test/test-chat-streaming.ts` (8 errors) and one line of
    `test/foundation/authTenantIsolation.test.ts` do not typecheck. Both predate this package, so
    tsconfig.test.json includes `test/baseline/**` and the FND-06 fixtures only. Widen the include
    when those are fixed — never by relaxing the options.
  - Embedding generation, the pgvector store, and retrievalIndexWriter have no baseline yet; the
    Chroma write path was chosen because it is the default provider and the one carrying the tenant
    predicate in metadata rather than in SQL.
  - The planner extracts a person filter from phrases as innocuous as "from last week", so the
    Retriever baseline always injects a resolver. A future planner fix should tighten that pattern;
    the baseline documents the behaviour rather than asserting it is correct.
follow_up_packages:
  - FND-07 (the module boundary can now be moved with a net under the existing code)
  - AGT-03 (routing sits in front of QueryPipeline; the frozen status vocabulary is its contract)
  - AGT-07 (the agent event stream must stay compatible with the SSE frames frozen here)
  - CON-01…CON-05 (connectors re-implement the sync boundary frozen in syncBoundaries.baseline)
  - QLT-01 (retrieval quality metrics; this package covers behaviour, not answer quality)
```

## What is frozen

| File | Surface | Cases |
| --- | --- | ---: |
| `retriever.baseline.test.ts` | Plan-driven hybrid retrieval, user scoping, fusion, degraded/failed legs, clarification | 18 |
| `queryPipeline.baseline.test.ts` | Status stream, tokens, context, conversation saves, stop/abort/failure | 14 |
| `queryTransformer.baseline.test.ts` | Follow-up detection and every rewrite outcome | 10 |
| `chatStreaming.baseline.test.ts` | SSE frame format, event order, ownership, disconnect | 14 |
| `conversationPersistence.baseline.test.ts` | Every ConversationRepository statement is user scoped | 9 |
| `googleNormalization.baseline.test.ts` | Gmail and Calendar normalization smoke tests | 17 |
| `syncBoundaries.baseline.test.ts` | Ingestion accounting and the HTTP sync edge | 18 |
| `vectorIndexing.baseline.test.ts` | Chroma record mapping, chunking, user-scoped read path | 16 |
| `mutationGuards.baseline.test.ts` | The acceptance criterion itself | 24 |

Supporting files: `test/fixtures/fnd06-baseline-fixtures.ts` (deterministic payloads and recording
doubles) and `test/baseline/baselineAssertions.ts` (the invariants, expressed once).

## New design recorded here

The plan named the surfaces to cover but not these choices:

| Decision | Choice | Rationale |
| --- | --- | --- |
| How "tests fail when filtering is removed" is proven | A permanent `mutationGuards` file asserting the *same* helpers throw on mutated values, with a control test that they pass on unmutated ones | A one-off manual check proves the net worked on the day it was written. Encoding the mutations keeps the claim true after every later refactor, and the control stops a helper that always throws from posing as a guard |
| Where invariants live | `baselineAssertions.ts`, imported by both the baselines and the guards | The criterion demands one assertion asserted twice — passing on real output, failing on mutated output. Duplicating it would let the two copies drift |
| Test isolation level | Every collaborator injected; no service, credential, or network anywhere | A regression gate that needs a provisioned laptop gets skipped. FND-03's integration suite already owns the live-database assertions |
| Two user ids in the fixtures | `OWNER_USER_ID = 101`, `INTRUDER_USER_ID = 202`, both positive integers | `getAuthenticatedUserId` rejects anything else, and a leak is only observable when the fixtures actually contain another account's rows |
| Rerank in the Retriever baseline | Pass-through double, `enableRerank: false` on the pipeline path | Freezing an LLM's ordering would produce a flaky gate that teaches people to ignore it |
| Injecting the person resolver | New optional `Retriever` dependency rather than module mocking | The resolver reads PostgreSQL, and the planner reaches it for ordinary queries. Every other collaborator on this class was already injectable; module mocking would have been the one exception |
| Injecting ingestion collaborators | Optional constructor object with the previous values as defaults | `runIngestion` constructs its own data source from a module-level map, so the fetch → normalize → persist accounting was otherwise unreachable without Google credentials |
| Client-disconnect behaviour | Frozen as "emits nothing further" | Current code returns early when the run is aborted *and* unsuccessful — no error frame, no done frame. That is deliberate (the socket is gone); the test records it so a later change is a decision rather than an accident |
| Test typechecking | Separate `tsconfig.test.json` extending the root config | The root project excludes `test/` so `dist/` stays production-only. FND-05.6 had to typecheck its test file by hand; this makes it one command |

## Enforced boundary

- No baseline test may reach a network, a database, or a credential. The Chroma suite pins
  `CHROMA_HOST`/`CHROMA_PORT` and clears `CHROMA_API_KEY` in `before`, restoring them in `after`,
  so a developer's cloud configuration cannot change the result.
- Both production seams added here are inert in production: `Retriever`'s `personResolver` is
  undefined so `buildResolvedRetrievalPlan` falls back to its own default, and
  `IngestionPipeline`'s constructor defaults are the values it previously hard-coded.
- `assertVectorSearchUserScoped` and `assertKeywordSearchUserScoped` fail on *zero* recorded calls.
  An ownership assertion that silently never ran is the failure mode this package exists to
  prevent, so it is treated as a failure rather than a pass.
