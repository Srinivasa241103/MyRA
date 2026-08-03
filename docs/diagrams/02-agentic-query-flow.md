# 02 — Query Flow

Master plan §5, §9.3.

## Flow 0 — Router fast path

Not every query deserves the agent loop. This saves roughly 70% of cost on real traffic.

```mermaid
flowchart TD
    Q["User query"] --> CLS{"[D] Classifier<br/>heuristics + cheap LLM"}
    CLS -->|"simple lookup"| FAST["V1 QueryPipeline<br/>~1.5s · 2 LLM calls"]
    CLS -->|"pure memory"| MEM["Memory Gateway recall only<br/>~0.8s · 1 LLM call"]
    CLS -->|"complex / multi-hop"| AGENT["Full agent loop<br/>~8-15s · 15-30 calls"]

    FAST --> ANS["Cited answer"]
    MEM --> ANS
    AGENT --> ANS
```

## Flow 1 — Agentic run lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant API as API + SSE
    participant G as LangGraph
    participant S as Supervisor
    participant F as Freshness [D]
    participant W as Source Agents
    participant TG as Tool Gateway [D]
    participant E as Evidence Ledger
    participant V as Verifier
    participant C as Curator

    U->>API: query
    API->>G: start run, checkpoint
    G->>C: recall entity + episodic + procedural
    C-->>G: scoped memories

    G->>S: plan
    S-->>G: subGoals + openQuestions + successCriteria
    G->>F: compute directives
    F-->>G: per-source index / refresh / live

    par parallel dispatch
        G->>W: subGoal A + directive
        W->>TG: tool calls
        TG->>E: normalize to evidence
    and
        G->>W: subGoal B + directive
        W->>TG: tool calls
        TG->>E: normalize to evidence
    end

    E-->>G: evidence IDs
    G->>S: judge sufficiency
    alt gap named and budget remains and new evidence appeared
        S-->>G: replan
        Note over G,W: max 3 iterations
    else sufficient
        S-->>G: proceed
    end

    G->>V: verify claims
    V->>TG: hydrate each citation by external ID
    TG-->>V: current content hash
    alt claim unsupported or stale
        V-->>G: targeted repair, max 2
    else pass
        V-->>G: verdicts
    end

    G->>API: synthesize + stream tokens
    API-->>U: cited answer + freshness labels + gaps
    G--)C: async consolidation
```

## SSE event stream

The reasoning trace is the product's best feature, not a debug view.

```mermaid
flowchart LR
    E1["run.started"] --> E2["status: recall"]
    E2 --> E3["plan.created<br/>subgoals + open questions"]
    E3 --> E4["freshness.decided<br/>per source + reason"]
    E4 --> E5["worker.spawned"]
    E5 --> E6["tool.called<br/>category only, never payloads"]
    E6 --> E7["evidence.added<br/>count + sources"]
    E7 --> E8["verification.result<br/>per claim"]
    E8 --> E9["token stream"]
    E9 --> E10["citations.resolved"]
    E10 --> E11["memory.changed"]
    E11 --> E12["run.completed"]

    INT["interrupt.clarification<br/>interrupt.approval"] -.can occur anywhere.-> E12
```

## Degradation — partial answers are first-class

```mermaid
flowchart TD
    F1["Tool errors"] --> D1["Source agent falls back to index-only<br/>reports a gap"]
    F2["Source agent dies"] --> D2["Run continues<br/>source marked unavailable"]
    F3["Verifier fails"] --> D3["Ship with lowered confidence<br/>+ explicit warning"]
    F4["Connector outage"] --> D4["Labelled partial answer<br/>never silent omission"]

    D1 --> OUT["answer + gaps + confidence + unavailableSources"]
    D2 --> OUT
    D3 --> OUT
    D4 --> OUT
```

## Journey — meeting brief

```mermaid
flowchart TD
    Q["Prepare me for tomorrow's meeting with Rahul about Project X"] --> P["[A] Plan"]
    P --> SG1["Resolve the meeting"]
    P --> SG2["Resolve Rahul and Project X"]
    P --> SG3["Recent discussions"]
    P --> SG4["Documents"]
    P --> SG5["Prior decisions and open commitments"]

    SG1 --> CAL["Calendar — LIVE<br/>latest intent"]
    SG2 --> ENT["[D] Entity Resolver<br/>one identity across sources"]
    SG3 --> GM["Gmail — LIVE"]
    SG3 --> SL["Slack — LIVE"]
    SG4 --> NO["Notion — INDEX"]
    SG4 --> DR["Drive — INDEX"]
    SG5 --> MEM["Memory — episodic + semantic"]

    CAL --> EV["Evidence Ledger"]
    ENT --> EV
    GM --> EV
    SL --> EV
    NO --> EV
    DR --> EV
    MEM --> EV

    EV --> HYD["[D] Hydrate citations"]
    HYD --> V["[A] Verify"]
    V --> BRIEF["Brief: details · participants · discussions<br/>documents · decisions · open items<br/>suggested agenda LABELLED AS RECOMMENDATION"]
```
