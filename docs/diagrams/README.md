# MyRA V2 — Flow Maps

Visual companion to `../MYRA_V2_PROJECT_MASTER_PLAN.md`. Every diagram here corresponds to a
section of the master plan; when the plan changes, these change with it.

| # | Diagram | Master-plan section |
| --- | --- | --- |
| [00](00-system-architecture.md) | System architecture and runtime planes | §7 |
| [01](01-agent-architecture.md) | Agent topology, contracts, and the blackboard | §8, §9 |
| [02](02-agentic-query-flow.md) | Router fast path and the agentic run lifecycle | §9.3, §5 |
| [03](03-freshness-and-live-data.md) | Freshness contract, 3-tier data movement, hydration | §8.8, §11.1, FRS-01…03 |
| [04](04-ingestion-pipeline.md) | Ingestion pipeline, push/pull/on-demand | §11, ING stream |
| [05](05-memory-engine.md) | Six memory layers, write path, read path, bi-temporal model | §10, MEM stream |
| [06](06-action-approval-flow.md) | Proposal → approval → idempotent execution → verification | §12.6, CAL stream |
| [07](07-tool-gateway-and-mcp.md) | Tool Gateway, policy engine, MCP client | §12, TOL stream |
| [08](08-evidence-and-citations.md) | Evidence ledger, deduplication, citation lifecycle | §11.3–11.5, EVD stream |
| [09](09-agent-testing-pipeline.md) | AI-DevOps: the daily pipeline that tests the agents | §18, §19, §20 |

## Reading the notation

| Shape / style | Meaning |
| --- | --- |
| Rectangle | Deterministic code — a rule, a service, a repository |
| Rounded | LLM-driven agent node — the model makes the decision |
| Diamond | Branch point |
| Cylinder | Persistent store |
| Dashed arrow | Asynchronous, off the response path |
| `[D]` prefix | Deterministic: no model call, unit-testable |
| `[A]` prefix | Agentic: model decides, bounded by budget |
