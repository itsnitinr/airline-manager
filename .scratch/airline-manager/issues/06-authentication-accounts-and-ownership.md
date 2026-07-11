# Implement authentication, accounts, and ownership authorization

Type: task
Status: resolved
Blocked by: 04

## Goal

Require a recoverable verified player account before persistent airline state can
be created or accessed.

## Scope

- Implement email/password registration, email verification, sign-in, sign-out,
  password reset, and account recovery.
- Implement Google sign-in using environment-provided provider credentials.
- Use secure, HTTP-only, same-site session cookies with rotation and revocation.
- Separate player identity, authentication credentials, sessions, and airline
  ownership records.
- Add request authorization that scopes every player query and command to owned
  resources.
- Add roles for ordinary players and administrators without granting admin
  capability through client claims.
- Rate-limit credential and recovery endpoints and audit security-sensitive
  account changes.

## Out of scope

- Anonymous persistent careers.
- Multiplayer invitations or shared airline ownership.
- Email gameplay notifications.

## Acceptance criteria

- Unverified or unauthenticated users cannot found or operate an airline.
- One account cannot read or mutate another account's airline through ID
  substitution or query filtering.
- Sessions can be revoked and expired sessions fail safely.
- OAuth and password secrets never enter logs, API responses, or committed files.
- Authentication and authorization flows have integration tests, including
  negative ownership cases.

## References

- ADR-0001: Multiplayer-ready ownership boundaries.
- ADR-0044: Authenticated ownership before airline founding.
- ADR-0048: Separate protected administration.

## Comments

- Implemented Better Auth 1.6.23 as the Fastify authentication adapter with verified
  email/password registration, sign-in/out, deterministic verification and recovery email capture,
  password-reset session revocation, rolling PostgreSQL sessions, optional environment-only Google
  OAuth, trusted origins/CSRF checks, secure cookie policy, and endpoint-specific rate limits.
- Added reviewed forward SQL for isolated Better Auth tables plus distinct player accounts,
  server-owned roles, opaque resource ownership, and append-only security audit events. Auth-user,
  player-account, and ordinary-role creation is atomic. The authorization contract always reloads
  roles/ownership server-side and returns the same denial for missing and foreign resource IDs.
- Documented public-safe setup and the exact ticket 08 transaction handoff: create the airline and
  bind its opaque UUID with a transaction-scoped identity repository before committing. No airline,
  ledger, gameplay, or gameplay-email schema was added.
- Validated frozen install, formatting, lint, dependency boundaries, OpenAPI/client freshness,
  type-check, unit tests, build, Compose configuration, API/migration images, blank/repeat
  migrations, generated Kysely types, 16 database integration tests, and 7 real-PostgreSQL auth and
  authorization integration tests. Verified cookie/origin/CORS/CSRF behavior, fake Google config,
  rate limiting, transaction rollback, immutable audits, log/API redaction, ignored files, diff
  whitespace, and clean Gitleaks scans of source plus Git history.
