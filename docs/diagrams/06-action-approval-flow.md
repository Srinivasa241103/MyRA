# 06 — Action Approval and Idempotent Execution

Master plan §12.6, CAL stream. Core gate: Calendar create. P1: Gmail send, on the identical machinery.

## The write-action state machine

```mermaid
stateDiagram-v2
    [*] --> Proposed: agent builds typed proposal
    Proposed --> Validated: schema, limits, scope, duplicate-likelihood
    Validated --> Hashed: normalize + hash material fields
    Hashed --> Persisted: store proposal BEFORE interrupting
    Persisted --> AwaitingApproval: LangGraph interrupt, checkpointed

    AwaitingApproval --> Rejected: user rejects
    AwaitingApproval --> Expired: expiry elapsed
    AwaitingApproval --> Edited: user edits
    Edited --> Validated: NEW hash, NEW approval required
    AwaitingApproval --> Claimed: approved + atomically claimed

    Claimed --> Executing: idempotency key recorded first
    Executing --> Succeeded: provider returns external ID
    Executing --> Failed: definite provider rejection
    Executing --> Unknown: timeout AFTER the call may have landed

    Unknown --> Reconciling: search provider by correlation metadata
    Reconciling --> Succeeded: found — adopt existing object
    Reconciling --> Claimed: proven NOT to have occurred
    Reconciling --> Unknown: still indeterminate — BLOCK repeat

    Succeeded --> Verifying: read back by external ID
    Verifying --> Verified: fields match approved proposal
    Verifying --> Mismatch: discrepancy surfaced and audited

    Verified --> [*]
    Rejected --> [*]
    Expired --> [*]
    Failed --> [*]
    Mismatch --> [*]
```

**Never** is `Unknown` converted into an automatic repeat. Uncertainty is reconciled, not retried.

## Approval binding

```mermaid
flowchart TD
    P["Proposal"] --> N["[D] Normalize material fields"]
    N --> H["[D] SHA-256 hash"]
    H --> BIND["Approval binds:<br/>userId + proposalId + payloadHash<br/>+ risk + expiry + schemaVersion"]

    BIND --> STORE[("action_approvals")]

    RESUME["Resume request"] --> CHECK{"[D] Validate"}
    CHECK -->|"wrong user"| DENY["Reject, non-disclosing"]
    CHECK -->|"hash differs"| DENY2["Reject — payload changed,<br/>new approval required"]
    CHECK -->|"expired"| DENY3["Reject"]
    CHECK -->|"already decided"| IDEM["Idempotent no-op"]
    CHECK -->|"valid"| LOAD["SERVER reloads the stored payload"]

    LOAD --> EXEC["Execute"]
    CLIENT["Client-supplied execution arguments"] -.->|"ALWAYS IGNORED"| LOAD
```

The client submits a proposal ID and hash. It never submits execution arguments.

## Idempotent execution

```mermaid
sequenceDiagram
    autonumber
    participant G as Graph
    participant R as Redis
    participant DB as PostgreSQL
    participant P as Provider

    G->>DB: BEGIN
    G->>DB: claim action WHERE status = approved
    Note over DB: unique idempotency constraint
    G->>R: acquire per-action lock
    alt already claimed or locked
        DB-->>G: no rows
        G-->>G: return the EXISTING receipt
    else claimed
        G->>DB: status = executing, record idempotency key
        G->>DB: COMMIT
        G->>P: single provider call<br/>with correlation metadata
        alt success
            P-->>G: external ID
            G->>DB: store external ID, status = succeeded
        else definite failure
            P-->>G: 4xx
            G->>DB: status = failed
        else timeout after possible success
            G->>DB: status = unknown
            G->>P: search by correlation metadata
            alt found
                G->>DB: adopt existing external ID
            else proven absent
                G->>DB: back to claimed, safe to retry
            end
        end
        G->>R: release lock
    end
```

## Post-condition verification

Completion is based on a provider read-back, not on the write response.

```mermaid
flowchart TD
    EX["Provider reports success"] --> RB["[D] Fetch by stored external ID"]
    RB --> CMP{"[D] Compare with approved proposal"}
    CMP -->|"title, times, timezone,<br/>attendees, description match"| OK["Verified — write receipt"]
    CMP -->|"any field differs"| MIS["Mismatch — surface + audit,<br/>do NOT claim success"]
    CMP -->|"not found"| UNK["Remain unknown — block repeat,<br/>present recoverable state"]

    OK --> MEM["Curator: episodic + prospective memory"]
    MIS --> NOMEM["NO success memory written"]
    UNK --> NOMEM
```

A failed or unknown action must never create a false success memory.

## Full user journey — schedule a meeting

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant A as Scheduling Agent
    participant E as Entity Resolver
    participant C as Calendar
    participant G as Graph
    participant CU as Curator

    U->>A: schedule a 30-min Project X review with Rahul tomorrow afternoon
    A->>A: CAL-01 extract title, duration, window, timezone
    A->>E: resolve "Rahul"
    alt ambiguous
        E-->>U: clarification interrupt with candidates
        U-->>E: choice
    end
    E-->>A: verified email + evidence

    A->>C: free/busy for all attendees, live
    C-->>A: busy blocks
    A->>A: CAL-03 rank candidate slots
    A-->>U: slots with brief reasons
    U-->>A: pick one

    A->>A: CAL-04 build exact payload, hash it
    A->>G: persist proposal, then interrupt
    G-->>U: preview — attendees, timezone,<br/>"invitations will be sent to all guests"

    alt approve
        U->>G: approve(proposalId, hash)
        G->>C: insert event, sendUpdates all, idempotency key
        C-->>G: external event ID
        G->>C: read back
        C-->>G: stored event
        G->>G: compare with approved payload
        G-->>U: receipt + link + verification status
        G--)CU: episodic + prospective memory
    else reject
        U->>G: reject
        G-->>U: nothing created
    else edit
        U->>G: edited payload
        G->>A: re-validate → NEW hash → NEW approval
    end
```

## Guarantees

| Guarantee | Mechanism |
| --- | --- |
| Nothing executes without approval | Durable interrupt, proposal persisted first |
| Executed payload equals approved payload | Server reloads by hash; client args ignored |
| At most one side effect | DB unique constraint + Redis lock |
| Timeout never duplicates | `unknown` state + provider reconciliation |
| Completion is real | Provider read-back comparison |
| Edits cannot ride an old approval | Any edit produces a new hash |
| Restart does not lose state | LangGraph checkpoint |
| Everything is explainable | Append-only audit across all transitions |
