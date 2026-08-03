# 09 — AI-DevOps: The Pipeline That Tests the Agents

Master plan §18, §19, §20.

Testing proves **code invariants**. Evaluation measures **model behavior**, where several
trajectories can be valid. They are different pipelines and they run at different cadences.

## The four cadences

```mermaid
flowchart TD
    DEV["Local — every save"] --> D1["typecheck · lint · affected unit tests"]

    PR["Pull request — every push"] --> P1["typecheck + build"]
    PR --> P2["unit · repository · graph · connector-contract"]
    PR --> P3["migration applies to empty DB"]
    PR --> P4["dependency · secret · static-security scan"]
    PR --> P5["6-case FAST EVAL, offline deterministic"]
    PR --> P6["mandatory permission + idempotency cases"]

    NIGHT["Nightly — scheduled"] --> N1["all 20 golden cases, MODEL-IN-LOOP"]
    NIGHT --> N2["critical safety cases × 3 repeats"]
    NIGHT --> N3["integration suite"]
    NIGHT --> N4["selected fault injection"]
    NIGHT --> N5["cost + latency vs baseline"]
    NIGHT --> N6["judge calibration — P1"]

    REL["Release"] --> R1["full eval + HARD GATES"]
    REL --> R2["sandbox E2E, dedicated test accounts"]
    REL --> R3["migration + rollback rehearsal"]
    REL --> R4["full failure suite + load smoke"]
    REL --> R5["OAuth scope review + manual trace review"]
```

## Three execution modes

```mermaid
flowchart LR
    subgraph M1["Offline deterministic"]
        A1["Fake model, recorded tool outputs"]
        A2["No network, no accounts"]
        A3["Owns ALL hard safety invariants"]
        A4["Fastest, most stable CI signal"]
    end
    subgraph M2["Model-in-the-loop"]
        B1["Pinned real model"]
        B2["Frozen synthetic fixtures"]
        B3["Measures routing, planning, groundedness"]
        B4["Captures token, cost, latency, variance"]
    end
    subgraph M3["Sandbox E2E"]
        C1["Dedicated test connector accounts"]
        C2["Verifies REAL external state"]
        C3["Before release only"]
    end

    M1 -->|"PR"| GATE1["Blocks merge"]
    M2 -->|"nightly"| GATE2["Blocks release on regression"]
    M3 -->|"release"| GATE3["Blocks ship"]
```

## Determinism harness — how an agent becomes testable

```mermaid
flowchart TD
    CASE["GoldenCase"] --> INJ["[D] Inject everything non-deterministic"]
    INJ --> I1["fixed clock + timezone"]
    INJ --> I2["seeded UUIDs"]
    INJ --> I3["recorded model outputs — offline mode"]
    INJ --> I4["mock connector state"]
    INJ --> I5["isolated PG schema + Chroma collection"]

    I1 --> RUN["Execute the graph"]
    I2 --> RUN
    I3 --> RUN
    I4 --> RUN
    I5 --> RUN

    RUN --> CAP["[D] Capture the full trajectory"]
    CAP --> T1["graph state transitions"]
    CAP --> T2["tool calls + arguments"]
    CAP --> T3["evidence + citations"]
    CAP --> T4["approvals + external side effects"]
    CAP --> T5["memory mutations"]
    CAP --> T6["cost + latency"]

    CAP --> EVAL["Evaluators"]
    RESET["[D] Reset mock external state between cases"] --> CASE
```

## Four evaluation levels

```mermaid
flowchart TD
    TRAJ["Captured trajectory"] --> L1["FINAL RESULT<br/>completion · correctness · groundedness<br/>citation precision and coverage"]
    TRAJ --> L2["STEP<br/>flow choice · plan validity · tool args<br/>freshness tier · approval decision<br/>memory classification"]
    TRAJ --> L3["TRAJECTORY<br/>required steps happened · forbidden did not<br/>reads before writes · approval before execution<br/>verification after execution · bounded loops"]
    TRAJ --> L4["EXTERNAL STATE<br/>created event matches approved fields<br/>EXACTLY the expected side-effect count<br/>no unrequested object changed"]

    L1 --> SCORE["Case verdict"]
    L2 --> SCORE
    L3 --> SCORE
    L4 --> SCORE
```

## Deterministic evaluators outrank judges

```mermaid
flowchart TD
    RES["Trajectory"] --> DET["[D] Deterministic evaluators"]
    DET --> D1["schema validity"]
    DET --> D2["flow, tool, and mode choice"]
    DET --> D3["freshness tier — 100% expected, it IS a function"]
    DET --> D4["approval before write + exact payload hash"]
    DET --> D5["user isolation and scopes"]
    DET --> D6["citation ID existence and same-run ownership"]
    DET --> D7["memory type, provenance, unsupported-write rejection"]
    DET --> D8["side-effect count and idempotency"]

    RES --> JDG(["[A] Semantic judges — bounded"])
    JDG --> J1["does cited evidence support this claim?"]
    JDG --> J2["answer completeness and relevance"]
    JDG --> J3["plan reasonableness"]
    JDG --> J4["memory candidate equivalence"]

    D4 --> HARD{"Hard safety failure?"}
    D5 --> HARD
    D8 --> HARD
    HARD -->|"yes"| FAIL["CASE FAILS<br/>regardless of any semantic score"]
    J1 -.->|"CANNOT override"| FAIL
```

## Fault injection

```mermaid
flowchart LR
    subgraph FAULTS["Injected"]
        F1["connector 429 / 5xx"]
        F2["pre-write and post-write timeout"]
        F3["expired / revoked OAuth"]
        F4["malformed or oversized MCP response"]
        F5["one source unavailable mid-run"]
        F6["duplicate / out-of-order resume"]
        F7["Chroma outage"]
        F8["Redis / checkpoint interruption"]
        F9["invalid structured model output"]
        F10["stale indexed data vs live"]
        F11["approval delayed across restart"]
    end

    FAULTS --> ASSERT["Every scenario must preserve:"]
    ASSERT --> A1["bounded retries"]
    ASSERT --> A2["explicit degradation, never silent"]
    ASSERT --> A3["audit completeness"]
    ASSERT --> A4["safe resume"]
    ASSERT --> A5["ZERO unauthorized or duplicate side effects"]
```

## Hard release gates

| Invariant | Required |
| --- | ---: |
| Unauthorized external actions | 0 |
| Cross-user data exposures | 0 |
| Duplicate external actions | 0 |
| Secrets in responses, logs, traces, reports | 0 |
| Stale citations reaching the user | 0 |
| Writes preceded by valid approval | 100% |
| Write args matching approved payload | 100% |
| Writes with a complete audit record | 100% |
| Critical safety cases across 3 repeats | 100% |

Any hard-gate failure blocks release regardless of aggregate score.

## The improvement loop — this is the "AI DevOps" part

```mermaid
flowchart TD
    PROD["Runs — dev and demo"] --> TRACE["LangSmith + OTel traces"]
    TRACE --> SAMPLE["[D] Sample failures and low-confidence runs"]
    SAMPLE --> REVIEW["Human review of the trajectory"]
    REVIEW --> DIAG{"What failed?"}

    DIAG -->|"code invariant"| BUG["Fix + regression test"]
    DIAG -->|"prompt or plan quality"| PROMPT["Revise + version the prompt"]
    DIAG -->|"retrieval or freshness"| RET["Tune contract or retrieval"]
    DIAG -->|"new failure mode"| NEW["Sanitize → NEW golden case"]

    BUG --> BASE
    PROMPT --> BASE
    RET --> BASE
    NEW --> DATASET["Versioned dataset + rationale"]
    DATASET --> BASE["Re-run against the accepted baseline"]

    BASE --> CMP{"Regression vs baseline?"}
    CMP -->|"yes"| BLOCK["Block — do NOT weaken the expectation"]
    CMP -->|"no"| PROMOTE["Promote as the new baseline"]
    PROMOTE --> PROD
```

**Rule:** never change an expected result to make a regression pass. Dataset changes require a
version bump and a written rationale.

## Version pinning

Every evaluation record pins the full configuration, so a score is reproducible and a regression is
attributable.

```mermaid
flowchart LR
    REC["Evaluation record"] --> V1["commit SHA"]
    REC --> V2["graph version"]
    REC --> V3["prompt versions"]
    REC --> V4["tool schema versions"]
    REC --> V5["model IDs"]
    REC --> V6["dataset version"]
    REC --> V7["evaluator version"]
    REC --> V8["fixture snapshot version"]
```

## Test-suite layout

```text
backend/test/
  baseline/      frozen V1 RAG + SSE behavior — must never regress
  unit/          agents · freshness · entities · tools · evidence · memory · actions · policies
  contract/      connectors · tools · api
  integration/   api · database · graph · retrieval · connectors · memory · actions
  e2e/           briefing · freshness · calendar · memory · gmail
  resilience/    fault injection
  security/      isolation · injection · scopes
  performance/   latency · concurrency · budgets
  fixtures/      synthetic sources, frozen snapshots
  helpers/       clock, seeded IDs, isolated namespaces
```

## Package completion gate

A feature is not done because its happy-path test passes.

```mermaid
flowchart TD
    PKG["Work package"] --> G1["deterministic policy/unit coverage"]
    G1 --> G2["contract or repository coverage where applicable"]
    G2 --> G3["one complete fixture flow"]
    G3 --> G4["one failure / recovery path"]
    G4 --> G5["user-isolation verification"]
    G5 --> G6["no regression in the fast baseline suite"]
    G6 --> DONE["Commit the package independently"]

    G1 -->|"any fails"| BLOCKED["Not complete — do not commit"]
```
