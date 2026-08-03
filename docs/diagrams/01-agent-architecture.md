# 01 — Agent Architecture

Master plan §8, §9.

## Agent topology

```mermaid
flowchart TD
    USER["User request"] --> SUP(["[A] Supervisor<br/>plan · decompose · judge · replan"])

    SUP --> MEMR["[D] Memory recall<br/>entity + episodic + procedural"]
    MEMR --> SUP

    SUP --> RES(["[A] Context Research Agent<br/>read-only, parallel"])
    SUP --> SCH(["[A] Scheduling Agent"])
    SUP --> KNO(["[A] Knowledge Agent"])

    RES --> BB[("L1 Blackboard<br/>Redis, per-run")]
    SCH --> BB
    KNO --> BB

    BB --> VER(["[A] Verification Agent<br/>grounding · hydration · contradiction"])
    VER -->|"revise + named gap"| SUP
    VER -->|"pass"| SYN(["[A] Synthesizer"])
    SYN --> OUT["Cited answer or action proposal"]

    OUT -.async.-> CUR(["[A] Memory Curator"])
    OUT -.async.-> REF(["[A] Reflector"])

    subgraph DET["Deterministic services — code, not agents"]
        FRS["Freshness Contract"]
        ENT["Entity Resolver"]
        POL["Policy Engine"]
        BUD["Budget Guard"]
    end

    FRS -.-> RES
    ENT -.-> RES
    ENT -.-> SCH
    ENT -.-> CUR
    POL -.-> SCH
    BUD -.-> SUP
```

## Anatomy of an agent

Every agent is the same runtime shell with different configuration. Differences are data, not code.

```mermaid
flowchart LR
    SPEC["AgentSpec"] --> R1["role — system prompt"]
    SPEC --> R2["tools — filtered registry slice"]
    SPEC --> R3["memoryScope — layers + entities"]
    SPEC --> R4["budget — tokens, calls, deadline"]
    SPEC --> R5["outputSchema — zod, always structured"]
    SPEC --> R6["loopPolicy — single or react"]
    SPEC --> R7["model — cheap, mid, strong"]

    SPEC --> RUNTIME["One runtime executes all agents"]
```

## Sub-agent contract

Hard rule: sub-agents return **claims plus citations**, never prose. Free-text hand-offs are where
multi-agent systems rot.

```mermaid
flowchart LR
    TASK["Task<br/>goal<br/>entityRefs<br/>toolIds<br/>freshness directive<br/>budget<br/>memoryScope"]
    TASK --> AGENT(["[A] Sub-agent"])
    AGENT --> RESULT["Result<br/>findings: claim + citations + confidence<br/>gaps: what it could not answer<br/>toolCalls: audit log<br/>status: complete | partial | failed"]
```

## Blackboard access model

Not a shared mutable blob — a Memory Broker with capability-scoped handles.

```mermaid
flowchart TD
    subgraph L1G["L1 Working — blackboard"]
        SHARED["Shared read view"]
        S1["run:id:agent:1 — own slice, writable"]
        S2["run:id:agent:2 — own slice, writable"]
        S3["run:id:agent:3 — own slice, writable"]
    end

    A1(["Source Agent 1"]) --> S1
    A2(["Source Agent 2"]) --> S2
    A3(["Source Agent 3"]) --> S3
    S1 --> SHARED
    S2 --> SHARED
    S3 --> SHARED
    SHARED --> A1
    SHARED --> A2
    SHARED --> A3

    subgraph LTM["Durable memory"]
        L2[("L2 Episodic")]
        L3[("L3 Semantic")]
        L4[("L4 Procedural")]
    end

    CUR(["Memory Curator"]) -->|"SOLE WRITER"| L2
    CUR --> L3
    CUR --> L4
    L3 -.read only.-> A1
    L4 -.read only.-> A1
```

Three rules:

1. **Single writer to durable memory.** Only the Curator writes L2/L3/L4 — no races, no half-baked facts.
2. **L1 is read-shared, write-partitioned.** Agents see each other's findings; none can clobber them.
3. **Recall is budgeted retrieval, not a dump.** Every agent gets a token budget for memory context.

## Memory access matrix

| Agent | L1 Working | L2 Episodic | L3 Semantic | L4 Procedural |
| --- | --- | --- | --- | --- |
| Supervisor | R + W | R | R | R |
| Context Research | R shared / W own slice | — | R scoped | R |
| Scheduling | R shared / W own slice | — | R scoped | R |
| Knowledge | R shared / W own slice | — | R scoped | R |
| Verification | R | R | R | — |
| Synthesizer | R | — | R | R |
| **Curator** | R | **W** | **W** | **W** |
| Reflector | R | R | R | **W** |

## The two loops

Coverage gaps and grounding failures are different failures and need different loops.

```mermaid
stateDiagram-v2
    [*] --> Recall
    Recall --> Plan
    Plan --> Dispatch
    Dispatch --> Gather
    Gather --> Judge

    Judge --> Plan: coverage gap - REPLAN LOOP max 3
    Judge --> Verify: sufficient

    Verify --> Repair: claim unsupported or stale
    Repair --> Verify: REPAIR LOOP max 2
    Verify --> Synthesize: all claims pass or dropped

    Synthesize --> [*]

    note right of Judge
        Also terminates when a replan
        produces zero new evidence IDs
        — the monotonic progress check.
    end note
```

## Autonomy versus bounds

| Model decides — autonomous | Graph enforces — deterministic |
| --- | --- |
| How to decompose the query | That a plan node runs first |
| Which sources are relevant | Which tools exist for this user |
| Which tool, args, order | Per-call budget and timeout |
| Whether findings are sufficient | Cycling back is allowed, max 3 times |
| What to replan and why | Progress check before re-entering |
| Whether a claim is grounded | That verification always runs |
| How to synthesize | Single-writer memory, approval before writes |

The graph never decides *what the answer is* or *what steps to take* — only what is structurally
permitted next.
