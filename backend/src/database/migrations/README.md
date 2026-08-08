# Database migrations

Run all pending migrations from `backend/`:

```bash
npm run migrate
```

Migration files use a four-digit ordered prefix. Applied filenames and SHA-256 checksums are
stored in `schema_migrations`; editing an applied file is rejected. Each migration runs in its own
transaction while a PostgreSQL advisory lock prevents concurrent runners from racing.

`0001_fnd_03_foundation.sql` is intentionally self-contained and applies to an empty PostgreSQL
database. `0002_fnd_03_integrity_hardening.sql` is a forward-only hardening migration that binds
steps, tool calls, and evidence to the same run; binds idempotency and receipts to an exact stored
approval; and aligns database hash/risk checks with the domain contracts. It safely backfills
legitimate idempotency records created after `0001` and refuses to migrate execution state that
has no matching approval.

`0003_agt_02_langgraph_checkpoints.sql` creates the LangGraph checkpointer's tables in a dedicated
`langgraph` schema. The library ships its own `setup()` that would create them at first use; that
is incompatible with forward-only migrations and with `MIGRATIONS_ON_BOOT=verify`, so the DDL is
owned here instead and the library's version ledger is pre-populated, which makes its `setup()` a
no-op. The file is a faithful mirror of the pinned library's migration array — nothing added, no
extra index — and `test/foundation/langgraphCheckpointSchema.unit.test.ts` fails the build if the
two ever drift. When the library ships a new migration, add `0004_*` that applies it; never edit
`0003`, which is checksummed.

These tables carry no `user_id`, so tenant isolation cannot come from them. It comes from
`agent_runs`: nothing may build a LangGraph thread config without first loading the run by
`(id, user_id)`.

None of these migrations create or modify the legacy `users`, conversations, documents, chunks,
credentials, sync, usage, or budget tables. User isolation is carried on every V2 record and is
enforced by repository query contracts plus composite ownership foreign keys between V2 tables.

The destructive integration reset is guarded by a dedicated database-name prefix:

```bash
FND_TEST_DATABASE_URL=postgresql://localhost/myra_fnd_test npm run test:foundation
```
