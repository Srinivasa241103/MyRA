# FND-03 — Establish migration and repository foundation

## Completion record

```yaml
id: FND-03
status: complete
contracts_changed: []
migrations:
  - backend/src/database/migrations/0001_fnd_03_foundation.sql
tests_run:
  - npm run test:foundation (disposable PostgreSQL; 4/4 passed)
  - npm run test:fnd-01
  - npm run test:fnd-02
  - npm run typecheck
  - npm run build
  - npm test
manual_validation:
  - Applied the migration to an empty disposable PostgreSQL database.
  - Re-ran the migration and confirmed the checksum ledger produced no schema mutation.
  - Confirmed User B cannot read or mutate User A runs, steps, evidence, connectors, actions, receipts, or audit history.
  - Confirmed duplicate same-user idempotency keys fail with PostgreSQL unique violation 23505.
  - Confirmed invalid lifecycle states fail with PostgreSQL check violation 23514.
known_limitations:
  - The migration is self-contained and does not bootstrap or alter legacy application tables.
  - PostgreSQL row-level security remains a production-hardening step; FND-03 enforces ownership through repository contracts and composite foreign keys.
  - Action state helpers establish atomic persistence boundaries; connector execution and reconciliation arrive in TOL-03 and CAL-06/CAL-07.
follow_up_packages:
  - FND-04
  - FND-05
  - FND-06
  - FND-07
```

## Persistence surface

The first ordered migration creates the V2 root records for agent runs, steps, tool calls,
evidence, action proposals, approvals, idempotency, action receipts, connector installations, and
audit events. Database checks use the FND-01/FND-02 flow, run, tool, evidence, proposal, approval,
receipt, and verification values.

Every child record carries `user_id`. Composite foreign keys such as `(run_id, user_id)` prevent a
record owned by one user from being attached to another user's run even if application code makes
an incorrect insert. Repository reads and mutations require `userId` and include it in the SQL
predicate.

## Migration policy

`npm run migrate` discovers four-digit SQL files in filename order. The runner:

- obtains a PostgreSQL advisory lock;
- creates and reads `schema_migrations`;
- verifies the SHA-256 checksum of every applied migration;
- runs each pending file in its own transaction;
- rejects edits to applied history; and
- reports already applied files without mutating the schema.

## Action transaction boundary

The action repository persists an immutable proposal, records an exact-hash approval, claims an
idempotency key under a serializable transaction, and records the external outcome atomically.
The database uniquely binds `(user_id, idempotency_key)` and one idempotency/receipt record to each
proposal. Unknown outcomes require error and reconciliation metadata; successful outcomes require
an external ID and provider result.

## Explicit scope boundary

FND-03 does not change authentication routes, create runtime service definitions, add LangGraph,
implement provider tools, enable external writes, or add memory persistence. Those remain assigned
to later packages in the master plan.
