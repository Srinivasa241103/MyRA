# 05 — Memory Engine

Master plan §10, MEM stream, ENT-01.

## Six layers

```mermaid
flowchart TD
    subgraph EPH["Ephemeral"]
        L1["L1 Working memory<br/>plan · findings · open questions · budget<br/>Redis, per-run TTL"]
        L2["L2 Conversational STM<br/>recent turns + rolling summary<br/>PostgreSQL, per-conversation"]
    end

    subgraph DUR["Durable — long-term memory"]
        L3["L3 Episodic<br/>what happened: runs, actions, corrections"]
        L4["L4 Semantic<br/>stable facts about people, projects, entities"]
        L5["L5 Prospective<br/>commitments, deadlines, upcoming events"]
        L6["L6 Procedural / preference<br/>routing hints, user preferences, plan templates"]
    end

    L0["L0 Source index<br/>document chunks + embeddings<br/>EVIDENCE, not memory"]

    L1 --> CUR(["Curator"])
    L2 --> CUR
    L0 -.grounds.-> CUR
    CUR --> L3
    CUR --> L4
    CUR --> L5
    CUR --> L6
```

L0 is deliberately outside the memory engine: it is retrieval over source documents, not knowledge
the system has formed.

## Write path — always asynchronous

Memory writes never block the user's response. This is the p95-latency answer.

```mermaid
flowchart TD
    TRIG["Run completes:<br/>verified answer or successful action receipt"] -.enqueue.-> JOB["Consolidation job"]

    JOB --> EX["[A] Extract atomic candidates<br/>from user statements, verified evidence,<br/>and action receipts ONLY"]
    EX --> GATE1{"[D] Has evidence?"}
    GATE1 -->|"no"| REJ1["Reject — model inference alone<br/>never creates durable fact"]
    GATE1 -->|"yes"| ENT["[D] Entity Resolver<br/>subject becomes an EntityRef"]

    ENT --> CLS["[A] Classify<br/>type · confidence · importance<br/>sensitivity · retention · factClass"]
    CLS --> GATE2{"[D] Policy:<br/>confidence, sensitivity,<br/>retention allowed?"}
    GATE2 -->|"no"| REJ2["Reject or flag for review"]
    GATE2 -->|"yes"| DEDUP

    DEDUP{"[D] Match against L3-L6<br/>exact structure first,<br/>semantic similarity second"}
    DEDUP -->|"equivalent"| REIN["Reinforce — bump confidence,<br/>append evidence"]
    DEDUP -->|"contradicts"| CONF["[D] Resolve:<br/>source authority → recency → confidence<br/>LLM adjudication ONLY on ties"]
    DEDUP -->|"new"| COMMIT

    CONF --> SUP["Supersede — new row,<br/>link supersedesMemoryId,<br/>set invalidatedAt on the old"]
    SUP --> COMMIT
    REIN --> COMMIT

    COMMIT["[D] Commit to PostgreSQL<br/>+ index outbox in the same transaction"]
    COMMIT --> CH[("Chroma memory collections")]
    COMMIT --> EVT["Emit trace + UI event"]
```

## Read path — scoped retrieval, never a dump

```mermaid
flowchart TD
    REQ["Agent memory request<br/>type · entity · time window · token budget"] --> ROUTE{"[D] Query shape"}

    ROUTE -->|"deadline, owner, status"| SQL["PostgreSQL structured filter FIRST<br/>prospective memory is a SQL problem,<br/>not a similarity problem"]
    ROUTE -->|"open-ended semantic"| VEC["Chroma similarity<br/>+ user, type, status, validity filters"]

    SQL --> MERGE
    VEC --> MERGE
    MERGE["[D] Score: similarity × recency ×<br/>importance × confidence"] --> BUD["[D] Truncate to token budget"]
    BUD --> OUT["Memories + provenance + confidence"]

    FALL["Chroma unavailable"] -.-> SQL
    FALL -.-> DEG["Degrade to structured PostgreSQL<br/>never fail the run"]
```

## Bi-temporal model

Two independent time axes. This is what most memory implementations get wrong.

```mermaid
flowchart LR
    subgraph W["World time — when it was true"]
        VF["validFrom"] --> VU["validUntil"]
    end
    subgraph S["System time — when we learned it"]
        RA["recordedAt"] --> IA["invalidatedAt"]
    end
```

**Worked example.** Rahul changed manager in March. MyRA learns it in June.

| Fact | validFrom | validUntil | recordedAt | invalidatedAt |
| --- | --- | --- | --- | --- |
| Manager is Priya | 2026-01-01 | **2026-03-15** | 2026-01-04 | **2026-06-02** |
| Manager is Arun | **2026-03-15** | — | **2026-06-02** | — |

This answers both *"who is Rahul's manager?"* and *"what did MyRA believe in April?"* — and it means
learning something in June does not retroactively rewrite what the system reported in April.

## Decay by fact class

```mermaid
flowchart LR
    FC{"factClass"} -->|"stable"| ST["Birthday, employer<br/>NO decay"]
    FC -->|"volatile"| VO["Current project, location<br/>fast decay curve"]
    FC -->|"ephemeral"| EP["Never promoted to durable"]

    VO --> TH{"below threshold?"}
    TH -->|"yes"| ARCH["Archive — status change,<br/>never hard delete"]
    ARCH --> INEL["Ineligible for retrieval,<br/>retained for audit"]
```

A single decay curve would either erase stable knowledge or preserve stale knowledge.

## Cross-source entity resolution — ENT-01

```mermaid
flowchart TD
    IN["Raw mentions across sources"] --> B["[D] Blocking<br/>cheap candidate generation"]
    B --> SC["[D] Score<br/>exact email → exact name → contextual"]
    SC --> TH{"confidence ≥ threshold?"}
    TH -->|"single strong match"| RES["Resolved EntityRef"]
    TH -->|"multiple plausible"| CLAR["Clarification interrupt<br/>never guess"]
    TH -->|"none"| UNRES["Unresolved — recorded as a gap"]

    subgraph SRC["Source-native identifiers"]
        S1["Slack U123"]
        S2["rahul@company.com"]
        S3["Notion person ID"]
        S4["Calendar attendee"]
        S5["Drive owner"]
    end
    SRC --> IN

    RES --> U1["Retrieval filters"]
    RES --> U2["CAL-02 attendee resolution"]
    RES --> U3["Curator fact subjects"]
    RES --> EVI["Resolution evidence stored<br/>— identity choices are auditable"]
```

Generalizes the existing `retrieval/personResolver.ts`. CAL-02 consumes it rather than
reimplementing attendee matching.

## Deletion — right to forget

```mermaid
flowchart TD
    DEL["forget(entityId) or delete(memoryId)"] --> C1["PostgreSQL status → deleted"]
    DEL --> C2["Chroma vector removal"]
    DEL --> C3["Redis cache eviction"]
    DEL --> C4["Eligible checkpoints and summaries"]
    DEL --> C5["Index outbox entry for repair"]

    C1 --> AUD["Audit the request<br/>WITHOUT retaining deleted content in logs"]
    C2 --> VER["Verify: absent from future retrieval"]
    C3 --> VER
    C4 --> VER
    C5 --> VER
```

## Memory inspector

The single most convincing thing to demo — corrections make the system measurably better.

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant API as Memory API
    participant PG as PostgreSQL
    participant C as Curator
    participant R as Reflector

    U->>API: what do you believe about me?
    API->>PG: list by entity, scoped to user
    PG-->>U: facts + provenance + confidence + status

    U->>API: this one is wrong
    API->>C: correction as HIGHEST-authority evidence
    C->>PG: supersede, set invalidatedAt, retain history
    C--)R: log the correction pattern
    R->>PG: L6 procedural entry
    Note over R: the system learns from being corrected
```
