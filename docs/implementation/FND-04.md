# FND-04 — Authentication and tenant isolation

```yaml
id: FND-04
status: complete
contracts_changed: []
migrations: []
tests_run:
  - npm run test:fnd-04
  - npm run test:foundation
  - npm run typecheck
  - frontend: npm run build
manual_validation: []
known_limitations:
  - OAuth transactions are process-local for the current single-backend deployment. A restart fails pending callbacks closed; a shared transaction store is required before multi-instance deployment.
  - Run, approval, connector, evidence, and memory HTTP routes do not exist yet. Their FND-03 repositories are user-scoped, and future routes must install the shared requireAuth boundary when their owning packages add them.
  - The PostgreSQL-backed FND-03 integration suite requires FND_TEST_DATABASE_URL and is skipped when that isolated test database is unavailable.
follow_up_packages:
  - FND-05
  - AGT-07
  - MEM-09
```

## Enforced boundary

- Chat, sync, stats, budget, current-user, profile-update, and logout routes require a verified server identity.
- The JWT verifier accepts only HS256 MyRA tokens and reduces the token payload to a trusted `userId` principal.
- The local bypass requires `ENABLE_AUTH_DEV_BYPASS=true` plus `SYNC_USER_ID`; production ignores the bypass flag.
- Chat, stats, and sync controllers no longer fall back to or accept request-owned user identity.
- Conversation, sync-log, credential, run, evidence, and connector queries include user scope.
- Cross-user conversation and sync lookup failures return the same not-found shape as absent resources.
- Socket.IO authenticates from the access token and sends sync events only to the authenticated user's room.
- Google OAuth uses browser-bound, one-time state plus S256 PKCE. Invalid, expired, wrong-browser, and replayed state fails before token exchange.

## Validation evidence

`backend/test/foundation/authTenantIsolation.test.ts` covers verified identity, spoofed body/query ownership, the production-disabled development bypass, OAuth PKCE/state/replay behavior, repository query scope, non-disclosing sync denial, per-user Socket.IO emission, and authentication installation across every currently implemented protected route family.
