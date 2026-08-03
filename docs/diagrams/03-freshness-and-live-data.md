# 03 — Freshness Contract and Live Data

Master plan §8.8, §11.1. Packages FRS-01, FRS-02, FRS-03.

This is the project's headline property. Everything here is deterministic — no model call.

## The contract

```mermaid
flowchart TD
    Q["Query"] --> RP["[D] retrievalPlanner.ts<br/>EXISTING — emits temporalIntent"]
    RP --> TI["temporalIntent<br/>latest | date_range | oldest | none"]

    VOL["[D] Volatility manifest<br/>Slack: minutes<br/>Gmail: hours<br/>Calendar: hours, future-weighted<br/>Notion: days<br/>Drive: days"] --> FN
    SL["[D] sync_logs.sync_completed_at<br/>EXISTING — index age per source"] --> FN
    TI --> FN{"[D] freshness<br/>temporalIntent × volatility × indexAge"}

    FN -->|"past date_range<br/>index within window"| M1["SERVE_INDEX"]
    FN -->|"index older than<br/>volatility window"| M2["REFRESH_THEN_SERVE"]
    FN -->|"latest intent on<br/>a volatile source"| M3["LIVE_FETCH"]

    M1 --> DIR["FreshnessDirective per source<br/>mode + reason"]
    M2 --> DIR
    M3 --> DIR

    DIR --> AG(["[A] Agent"])
    AG -->|"escalate with reason"| UP["Allowed: index → refresh → live"]
    AG -->|"downgrade"| DOWN["REJECTED and logged"]
```

**Why deterministic.** The decision is expressible as a rule, so it costs nothing, is unit-testable
across the full input matrix, and fails visibly rather than silently serving stale data. Model
judgment is reserved for escalation, where a rule cannot express the reason.

## Decision table

| temporalIntent | Source volatility | Index age | Mode |
| --- | --- | --- | --- |
| `latest` | minutes / hours | any | `LIVE_FETCH` |
| `latest` | days | within window | `REFRESH_THEN_SERVE` |
| `date_range` in the past | any | any | `SERVE_INDEX` |
| `date_range` including now | minutes / hours | any | `LIVE_FETCH` |
| `oldest` | any | any | `SERVE_INDEX` |
| `none` | any | within window | `SERVE_INDEX` |
| `none` | any | beyond window | `REFRESH_THEN_SERVE` |

## Three-tier data movement

```mermaid
flowchart LR
    subgraph T1["Tier 1 — PUSH"]
        W1["Gmail watch / Pub-Sub"]
        W2["Slack Events API"]
        W3["Drive push notifications"]
        W4["Notion polling delta"]
    end

    subgraph T2["Tier 2 — PULL"]
        C1["Cron delta sync"]
        C2["Native change tokens:<br/>Gmail historyId<br/>Drive pageToken<br/>Slack cursor<br/>Notion last_edited_time"]
    end

    subgraph T3["Tier 3 — ON DEMAND"]
        L1["Agent LIVE_FETCH<br/>at query time"]
    end

    W1 --> QUEUE["Redis queue"]
    W2 --> QUEUE
    W3 --> QUEUE
    W4 --> QUEUE
    C1 --> QUEUE
    C2 --> C1
    L1 --> PIPE

    QUEUE --> PIPE["Normalize → chunk → embed → index<br/>ONE pipeline, three entry points"]
    L1 -. "write-behind, async" .-> PIPE

    PIPE --> PG[("PostgreSQL<br/>canonical + BM25")]
    PIPE --> CH[("ChromaDB<br/>vectors")]
```

## FRS-02 — Write-behind

Live fetches are never throwaway. This is a read-through cache fill.

```mermaid
sequenceDiagram
    autonumber
    participant A as Source Agent
    participant TG as Tool Gateway
    participant P as Provider API
    participant E as Evidence Ledger
    participant I as Ingestion
    participant DB as PG + Chroma

    A->>TG: LIVE_FETCH
    TG->>P: read call
    P-->>TG: fresh objects
    TG->>E: normalize to evidence
    E-->>A: evidence IDs
    Note over A: answer proceeds immediately

    TG--)I: async write-behind
    I->>I: dedupe by external ID<br/>reuse existing documentsMatch
    I->>DB: normalize → chunk → embed → index
    Note over DB: next equivalent query is warm<br/>and served by SERVE_INDEX
```

A write-behind failure degrades to a logged warning — it never fails the user's run.

## FRS-03 — Citation hydration

Kills the number-one RAG failure: citing an email that was deleted or a page that was edited.

```mermaid
flowchart TD
    EV["Evidence used by a claim<br/>externalId + contentHash stored at retrieval"] --> H["[D] Hydrate<br/>re-fetch by external ID, in parallel"]

    H --> CH{"Compare"}
    CH -->|"404 / inaccessible"| S1["STALE — source gone"]
    CH -->|"hash mismatch"| S2["STALE — source edited, name the change"]
    CH -->|"hash matches"| OK["SUPPORTED"]

    S1 --> DROP{"Any other evidence<br/>supports this claim?"}
    S2 --> DROP
    DROP -->|"yes"| OK2["Claim survives on remaining evidence"]
    DROP -->|"no"| REP["Fail the claim → bounded repair loop"]
    REP -->|"repair exhausted"| CUT["Drop the claim<br/>never silently ship it"]

    OK --> ANS["Answer"]
    OK2 --> ANS
```

Cost bound: one read call per cited object, in parallel, inside the run's tool budget. Only cited
evidence is hydrated — not the whole retrieval set.

## Worked contrast

```mermaid
flowchart LR
    subgraph A["'Has Rahul replied yet?'"]
        A1["temporalIntent = latest"] --> A2["Gmail → LIVE_FETCH"]
        A1 --> A3["Notion, Drive → SERVE_INDEX"]
        A2 --> A4["write-behind fills index"]
        A4 --> A5["hydrate cited messages"]
    end

    subgraph B["'What did we decide in June?'"]
        B1["temporalIntent = date_range, past"] --> B2["ALL sources → SERVE_INDEX"]
        B2 --> B3["zero live calls"]
        B3 --> B4["hydrate cited messages"]
    end
```

The difference between these two runs is deterministic, testable, and visible in the trace — which
is exactly why it gets its own evaluation category.
