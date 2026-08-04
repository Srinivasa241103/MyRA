# FND-07 — Establish the V2 TypeScript module boundary

```yaml
id: FND-07
status: complete
contracts_changed:
  - src/observability/index.ts (new public surface; index.js, src/app.js, and
    src/api/routes/health.ts now import it instead of reaching into health internals)
  - src/agents/index.ts, src/tools/index.ts, src/tools/adapters/index.ts, src/actions/index.ts,
    src/evidence/index.ts, src/memory/index.ts, src/entities/index.ts, src/freshness/index.ts,
    src/connectors/index.ts, src/evaluation/index.ts (new; each module's declared public surface)
  - src/agents/contracts/index.ts (documented as the layer-0 contract boundary; exports unchanged)
  - architecture/moduleBoundaries.ts (new; the layering, allowed edges, credential and legacy rules)
  - architecture/importGraph.ts (new; dependency-free static scanner and boundary analyzer)
  - tsconfig.v2.json (new; strict, no-emit, scoped to the ten V2 modules)
  - package.json (new scripts typecheck:v2, test:fnd-07, check:architecture; added @types/pg)
migrations: []
tests_run:
  - npm run test:fnd-07 (32/32 passed)
  - npm run typecheck:v2 (clean — strict over all V2 modules and their transitive dependencies)
  - npm run typecheck (clean — the loose legacy project is unchanged)
  - npm run build (clean)
  - npm run test:fnd-06 (140/140 passed — the FND-06 baseline is untouched by the rewiring)
  - npm run test:foundation (147 tests; 146 passed, 1 skipped — the FND-03 integration suite
    without FND_TEST_DATABASE_URL)
  - npm run typecheck:baseline (clean)
manual_validation:
  - Booted the real index.js against the developer's live services. The rewired boot path came up
    fully: /health/live 200, /health/ready 200 with postgres, chroma, redis, and migrations all ok,
    /health/startup 200. SIGTERM drained in order (draining → cron → redis → pool → stopped) and
    logged {"exitCode":0,"forced":false,"failures":0}. Zero ERROR lines in the boot log.
  - Confirmed existing chat still runs, not just builds: /chat/conversations, /chat/message, and
    /chat/message/stream each answered 401 {"success":false,"error":"Authentication required."}
    with no token — routes mounted, FND-04 guard intact, no import-time breakage from the barrel.
  - Verified the architecture check rejects real violations, not only synthetic ones. Three
    mutations of production code, each reverted afterwards:
      * appending `import { google } from "googleapis"` to src/agents/index.ts → 2 tests red
        (credential-dependency).
      * pointing src/app.js back at src/observability/health/readinessState.js → 3 tests red
        (internal-import, plus the expected-edge guard).
      * making src/evidence/index.ts and src/memory/index.ts import each other → 2 tests red
        (module cycle and undeclared dependency).
    The tree returned to 32/32 after each revert.
known_limitations:
  - The checker is static text analysis, not the TypeScript resolver. It follows relative
    specifiers and bare package names; it cannot see a specifier assembled at runtime, and it would
    need work if tsconfig path aliases were ever introduced (there are none today). Comments,
    strings, and template literals are blanked before matching, so documentation cannot fake an edge.
  - `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are off. Both currently fail inside
    shipped FND-05 health code (probes.ts, registry.ts) and the legacy migration runner pulled in
    transitively. Enabling them is a follow-up with real edits behind it; excluding observability
    from strict checking to get them would have been the worse trade.
  - Eight of the twelve boundaries are empty barrels today. That is the point of the package — the
    boundary exists before the code, so AGT/TOL/CON/MEM land inside it — but it does mean most
    dependency edges are asserted against declarations rather than against real imports. The
    synthetic guards cover the edges that do not exist yet.
  - Tests may still import module internals. They assert on implementation, which is what a public
    surface is explicitly not for; the rule is scoped to `src/**` and the process entry point.
  - `src/jobs` exists (empty) and is not a declared V2 module, so it is treated as legacy. If BRF or
    the write-behind work puts code there, add it to the manifest first.
  - The legacy allowlists (`entities` → src/RAG/retrieval, `toolAdapters` → src/RAG,
    src/service/sources, src/service/normalizers, `evaluation` → src/RAG) are pre-authorised for
    packages that do not exist yet. They are the V1 seams the plan's §14.2 refactor map already
    names; each should shrink as those packages land.
follow_up_packages:
  - AGT-01…AGT-07 (land inside src/agents; the contracts boundary is already below them)
  - TOL-01…TOL-04 (src/tools/core and src/tools/adapters; the gateway rule is already enforced)
  - CON-01…CON-05 (src/connectors; the only module permitted to hold credentials)
  - EVD-*, MEM-*, ENT-01, FRS-* (their boundaries and allowed edges are declared)
  - OBS-01 (tracing, metrics, audit — behind the observability surface that already exists)
```

## What was created

| Boundary | Directory | Layer | May depend on |
| --- | --- | ---: | --- |
| `contracts` | `src/agents/contracts` | 0 | — |
| `observability` | `src/observability` | 0 | — |
| `connectors` | `src/connectors` | 0 | contracts, observability |
| `freshness` | `src/freshness` | 1 | contracts, observability |
| `entities` | `src/entities` | 1 | contracts, observability |
| `evidence` | `src/evidence` | 1 | contracts, observability, freshness, entities |
| `memory` | `src/memory` | 1 | contracts, observability, evidence, entities |
| `toolAdapters` | `src/tools/adapters` | 1 | contracts, observability, connectors |
| `tools` | `src/tools` | 2 | + toolAdapters, evidence, memory, entities, freshness |
| `actions` | `src/actions` | 3 | contracts, observability, tools, evidence |
| `agents` | `src/agents` | 4 | + tools, actions, evidence, memory, entities, freshness |
| `evaluation` | `src/evaluation` | 5 | everything; nothing may import it |

Plus `architecture/moduleBoundaries.ts` (the declaration), `architecture/importGraph.ts` (the
analyzer), `test/architecture/moduleBoundaries.test.ts` (32 cases), and `tsconfig.v2.json`.

## New design recorded here

The plan named the modules and the two hard rules but not these choices:

| Decision | Choice | Rationale |
| --- | --- | --- |
| Ten modules, twelve boundaries | `agents/contracts` and `tools/adapters` are boundaries of their own | The two rules that matter most are about them. Contracts are layer 0 despite living inside `src/agents/`, so `evidence` and `memory` can speak the vocabulary without depending on the graph. Adapters are a layer below the gateway, which is what "provider adapters below the Tool Gateway" has to mean if it is to be checkable |
| Where the contracts live | Left in `src/agents/contracts`, reclassified rather than moved | The plan's own structure sketch puts them there and FND-02 shipped them there. Moving them would churn a delivered package to fix a problem a declaration solves |
| How the rules are enforced | A dependency-free scanner in `architecture/`, run as a test | A rule that only runs when an extra devtool is installed and configured is a rule that stops running. It also keeps the check honest about *this* repo's conventions (NodeNext `.js` specifiers pointing at `.ts` files) |
| Proving the check works | Synthetic violation guards for every rule, plus three real mutations of production code | Same reasoning as FND-06: a checker nobody has seen reject anything is indistinguishable from one that cannot. The guards make it permanent; the manual mutations proved it against the real scan |
| Public-surface enforcement | Cross-boundary imports must target the declared `index.ts`; internals are private | Otherwise a "module" is just a folder name. This is what forced the observability rewiring, and it is what will stop a node from reaching into `evidence/evidenceLedger.ts` when that file exists |
| Undeclared legacy imports | Rejected unless the path is shared infrastructure or in the module's `legacyAllowlist` | Without this rule, `agents` importing `src/service/sources/GmailDataSource.js` matches no credential pattern and no Express path — it would sail through while bypassing the gateway entirely. The allowlists make each V1 seam a written decision |
| Strictness scope | A second no-emit project, not a change to the root config | The root project still compiles and emits the whole mixed JS/TS backend loosely, so existing chat is untouched. New code starts strict instead of being migrated to strict later, which never happens |
| `@types/pg` | Added as a devDependency | Without it, `src/config/dbConfig.ts` and the migration runner fail strict checking with implicit `any`, which would have meant excluding observability from the strict project. No source changes were needed once the types were present |

## Enforced boundary

- `architecture/**` is imported by the test and by nothing at runtime, so the declaration can never
  become load-bearing for behaviour.
- Every relative import in `src/` plus `index.js` resolves — asserted explicitly, because an
  unresolvable specifier would silently reduce the analysis to a partial graph and turn every
  downstream "no violations" result into a false pass.
- Cycles are checked twice: between modules, and between files *inside* a module. The second is
  stricter and catches the mutual-import knots that form long before a module-level cycle appears.
- The credential rule matches on the raw specifier, so `googleapis` as a package import and
  `../../database/credentialRepository.js` as a relative one are both caught in
  `agents`, `contracts`, `evidence`, `memory`, `entities`, `freshness`, and `actions`.
