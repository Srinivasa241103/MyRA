# 04 — Ingestion Pipeline

Master plan §11, ING stream.

## One pipeline, three entry points

```mermaid
flowchart TD
    E1["PUSH — webhook"] --> Q
    E2["PULL — cron delta"] --> Q
    E3["ON-DEMAND — agent live fetch"] -.async.-> Q
    Q["Redis queue<br/>per-user + per-source dedupe, leases, backoff"] --> FETCH

    FETCH["Source adapter fetch<br/>cursor-bounded page"] --> NORM["Normalizer<br/>→ UnifiedDocument"]
    NORM --> DEDUP{"[D] Exists by<br/>stable external ID?"}

    DEDUP -->|"no"| INS["Insert canonical document"]
    DEDUP -->|"yes, unchanged"| SKIP["Skip<br/>existing documentsMatch check"]
    DEDUP -->|"yes, changed"| UPD["Update + mark for reindex"]

    INS --> OUTBOX["Index outbox record<br/>same transaction"]
    UPD --> OUTBOX

    OUTBOX --> CHUNK["Source-aware chunker<br/>Slack threads · Notion blocks · Drive sections"]
    CHUNK --> EMB["Embedding pipeline<br/>batched, cost-logged"]
    EMB --> KW[("PostgreSQL<br/>BM25 term frequencies")]
    EMB --> VEC[("ChromaDB<br/>vectors")]

    KW --> READY["Mark retrieval-ready"]
    VEC --> READY

    CURSOR["Persist source cursor<br/>ONLY after canonical commit"]
    INS --> CURSOR
    UPD --> CURSOR
    SKIP --> CURSOR
```

## Why the outbox

Canonical records and embeddings commit to two different systems, so they can diverge. Without the
outbox, a failed vector upsert silently produces a document that exists but can never be retrieved.

```mermaid
sequenceDiagram
    autonumber
    participant I as Ingestion
    participant PG as PostgreSQL
    participant CH as Chroma
    participant R as Reconciler

    I->>PG: BEGIN
    I->>PG: upsert canonical document
    I->>PG: insert index_outbox row
    I->>PG: COMMIT
    Note over PG: canonical truth is safe

    I->>CH: upsert vectors
    alt success
        CH-->>I: ok
        I->>PG: mark outbox processed
    else Chroma down
        CH-->>I: error
        Note over PG: outbox row stays pending<br/>document is NOT marked retrieval-ready
    end

    R->>PG: scan pending / stuck outbox
    R->>CH: replay upserts and deletions
    R->>PG: mark processed
    Note over R: reuses existing<br/>reconcileRetrievalIndexes.ts
```

## Tombstones — ING-02

Deleted and cancelled source objects must stop appearing in retrieval while staying auditable.

```mermaid
flowchart LR
    T1["Calendar event cancelled"] --> TB["Record tombstone<br/>in canonical metadata"]
    T2["Gmail message deleted"] --> TB
    T3["Notion page archived"] --> TB
    T4["Drive permission lost"] --> TB

    TB --> IN["Mark chunks ineligible"]
    TB --> VD["Delete or flag vectors"]
    IN --> RES["Disappears from active retrieval"]
    VD --> RES
    TB --> AUD["Retained for audit and replay"]

    RES --> HYD["FRS-03 hydration catches<br/>anything the tombstone missed"]
```

Two independent defenses: tombstones remove stale content proactively; citation hydration catches
whatever slipped through at answer time.

## Backfill on connector onboarding

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant API as API
    participant C as Connector
    participant TR as Tool Registry
    participant J as Backfill job
    participant WS as Socket.IO

    U->>API: connect source
    alt Google
        API->>C: OAuth, least-privilege read scopes
    else Slack / Notion
        API->>C: MCP handshake
        C->>C: tools/list → JSON Schema → zod
    end
    C-->>TR: register internal stable names
    Note over TR: per-user registry;<br/>agents see only allowed tools

    API->>J: enqueue bounded historical sync
    loop paged
        J->>C: fetch page
        J->>J: normalize → chunk → embed → index
        J->>WS: progress
        WS-->>U: live progress
    end
    J->>C: register webhook if supported
    J-->>TR: mark source available

    Note over TR: agents pick up the new source<br/>with zero code change
```
