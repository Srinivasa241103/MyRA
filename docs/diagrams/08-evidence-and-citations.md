# 08 — Evidence Ledger and Citations

Master plan §11.3–11.5, EVD stream.

## Evidence lifecycle

```mermaid
flowchart TD
    R1["Live connector result"] --> N["[D] Source-specific normalizer"]
    R2["indexed_search chunk"] --> N
    R3["Memory Gateway record"] --> N

    N --> EI["EvidenceItem<br/>source · sourceRecordId · canonicalUrl<br/>title · content · author · occurredAt<br/>retrievedAt · freshness · contentHash"]

    EI --> SCOPE{"[D] User scope"}
    SCOPE -->|"mismatch"| REJ["Reject — cross-user exposure<br/>is release-blocking"]
    SCOPE -->|"ok"| DEDUP

    DEDUP["[D] Deduplicate"] --> D1["by source + external ID"]
    DEDUP --> D2["by canonical URL"]
    DEDUP --> D3["by content hash"]
    DEDUP --> D4["by guarded semantic similarity"]

    D1 --> PREF{"[D] Live vs indexed<br/>copy of the same object?"}
    D2 --> PREF
    D3 --> PREF
    D4 --> PREF
    PREF -->|"indexed is stale"| KEEPL["Prefer live"]
    PREF -->|"equivalent"| KEEP1["Keep one"]

    KEEPL --> LEDGER[("evidence_items<br/>run-scoped, user-scoped")]
    KEEP1 --> LEDGER

    LEDGER --> CID["[D] Stable citation IDs"]
    LEDGER --> CONF["[D] Contradiction detection<br/>preserve BOTH, never silently pick"]
```

Large content is stored in the ledger, not in graph state — checkpoints carry evidence IDs only.

## Freshness labelling

```mermaid
flowchart LR
    F1["live"] --> M1["Fetched during this run"]
    F2["recent_index"] --> M2["Indexed within the source's volatility window"]
    F3["stale_index"] --> M3["Indexed beyond the window — disclosed to the user"]
    F4["memory"] --> M4["From durable memory, carries its own provenance"]

    M1 --> UI["Citation card shows the label"]
    M2 --> UI
    M3 --> UI
    M4 --> UI
```

## Claim → citation → evidence

The frontend must never rely on model-written `[Source N]` text.

```mermaid
flowchart TD
    SYN(["[A] Synthesizer"]) --> CLAIMS["Claims, each with evidenceIds"]
    CLAIMS --> MAP["[D] Citation service<br/>maps claim → stable citation ID"]

    MAP --> V1{"[D] Citation ID exists?"}
    V1 -->|"no"| F1["Verifier failure — fabricated citation"]
    V1 -->|"yes"| V2{"[D] Same run and same user?"}
    V2 -->|"no"| F2["Reject — cross-run leakage"]
    V2 -->|"yes"| V3{"[D] Material claim uncited?"}
    V3 -->|"yes"| F3["Verifier failure — ungrounded claim"]
    V3 -->|"no"| HYD["FRS-03 hydration"]

    HYD --> V4{"Source still says this?"}
    V4 -->|"404 or hash mismatch"| F4["STALE — repair or drop the claim"]
    V4 -->|"match"| OK["Structured citation card:<br/>source · title · author · time<br/>freshness · bounded excerpt · canonical URL"]
```

## Contradiction handling

```mermaid
flowchart TD
    E1["Slack, 3 Mar: 'we're going with Postgres'"] --> C{"[D] Contradiction detected"}
    E2["Notion, 11 Mar: 'decision: Chroma'"] --> C

    C --> KEEP["Preserve BOTH pieces of evidence"]
    KEEP --> SIG["Signal to the synthesizer:<br/>sources disagree, with timestamps"]
    SIG --> ANS["Answer states the disagreement<br/>and which source is newer"]
    SIG --> NOPICK["NEVER silently select one<br/>and present it as settled"]

    ANS --> MEM["Curator: conflict recorded,<br/>later source supersedes if authority allows"]
```

## Why the ledger exists

| Without a ledger | With the ledger |
| --- | --- |
| Citations are model-authored strings | Citations resolve to stored records |
| Live and indexed copies both appear | Deduplicated to one |
| No way to verify a claim after the fact | Every claim traces to a hashed record |
| Replaying a run means re-calling providers | Sanitized snapshots replay offline |
| Cross-user leakage is invisible | Scope is enforced at write and read |
| Deleted sources still get cited | Hydration catches them |
