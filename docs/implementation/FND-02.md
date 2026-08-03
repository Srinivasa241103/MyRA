# FND-02 — Add domain contracts

## Completion record

```yaml
id: FND-02
status: complete
contract_version: 2.0.0
contracts_changed:
  - backend/src/agents/contracts/domain/
  - backend/src/agents/contracts/index.ts
migrations: []
tests_run:
  - npm run test:fnd-02
  - npm run test:fnd-01
  - npm run typecheck
  - npm run build
manual_validation:
  - Confirmed all persisted/runtime domain objects require explicit user scope.
  - Confirmed interrupt payloads and nested domain payloads accept plain JSON only.
  - Confirmed domain contracts contain no LangGraph or model-framework dependency.
known_limitations:
  - These contracts define shapes and local invariants only; repositories arrive in FND-03.
  - Graph state channels and reducers remain assigned to AGT-01.
follow_up_packages:
  - FND-03
  - FND-07
  - AGT-01
```

## Contract surface

FND-02 defines versioned Zod schemas and inferred TypeScript types for `AgentRun`, `Plan`,
`PlannedSubtask`, `ToolCall`, `ToolResult`, `EvidenceItem`, `Citation`, `ActionProposal`,
`ApprovalDecision`, `ActionReceipt`, `VerificationResult`, and `MemoryCandidate`.

The run contract composes the FND-01 supported-flow and run-status schemas instead of redefining
them. Terminal runs, clarification/approval interrupts, tool outcomes, action receipts, and
verification results are discriminated unions so state-specific required fields cannot be
silently omitted.

## Serialization boundary

`serializeContract` validates a value before encoding it, while `deserializeContract` validates
again after JSON decoding. The shared JSON guard rejects cycles, non-finite numbers, dates,
functions, bigint/symbol values, accessor properties, unsafe object keys, and custom prototypes.
This keeps interrupt and checkpoint-ready payloads portable across process restarts.

## Explicit scope boundary

FND-02 does not add LangGraph state, reducers, repositories, migrations, routes, connector
adapters, policy execution, or runtime behavior. Those remain assigned to later work packages.
