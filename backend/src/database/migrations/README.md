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

Neither migration creates or modifies the legacy `users`, conversations, documents, chunks,
credentials, sync, usage, or budget tables. User isolation is carried on every V2 record and is
enforced by repository query contracts plus composite ownership foreign keys between V2 tables.

The destructive integration reset is guarded by a dedicated database-name prefix:

```bash
FND_TEST_DATABASE_URL=postgresql://localhost/myra_fnd_test npm run test:foundation
```
