# FND-01 — Freeze product and flow contracts

## Completion record

```yaml
id: FND-01
status: complete
contract_version: 2.0.0
contracts_changed:
  - backend/src/agents/contracts/flowContracts.ts
  - backend/src/agents/contracts/index.ts
migrations: []
tests_run:
  - npm run test:fnd-01
  - npm run typecheck
  - npm run build
manual_validation:
  - Confirmed all seven master-plan journeys have exactly one contract owner.
  - Confirmed read-only flows expose no provider write tool or approval result.
  - Confirmed every write flow requires exact-payload approval before execution.
known_limitations:
  - This package freezes top-level flow behavior only; FND-02 owns detailed domain contracts.
  - P1 flow contracts are defined but their Gmail runtime behavior is not implemented.
follow_up_packages:
  - FND-02
```

## Frozen flow ownership and release boundary

| Flow | Contract owner | Release tier | Approval boundary |
| --- | --- | --- | --- |
| `simple_lookup` | `rag_fast_path` | Core | None; source reads are limited to citation hydration |
| `cross_source_answer` | `context_research` | Core | None |
| `meeting_brief` | `meeting_briefing` | Core | None |
| `schedule_meeting` | `calendar_scheduling` | Core | Exact event proposal before Calendar write |
| `email_compose` | `gmail_communication` | P1 | Exact message proposal before send |
| `email_reply` | `gmail_communication` | P1 | Exact reply proposal before send |
| `post_meeting_followup` | `post_meeting_followup` | P1 | Separate exact approval for every supported write |

The executable registry is the source of truth for each flow's required evidence, allowed internal
tools, success criteria, result statuses, approval rule, and non-goals. Provider-specific tool
names and LangGraph types are intentionally excluded.

## Result contract

The versioned discriminated result union covers:

- `success`
- `partial_success`
- `clarification_required`
- `approval_required`
- `rejected`
- `failure`

Agent-run lifecycle statuses are frozen separately so a run status such as `completed` cannot be
mistaken for a flow result status such as `success`.

## Explicit scope boundary

FND-01 does not add LangGraph state, detailed evidence/action/memory domain objects, migrations,
repositories, routes, connectors, or runtime behavior. Those remain assigned to FND-02 and later
packages in the master plan.
