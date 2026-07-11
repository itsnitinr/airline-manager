# Implement authentication, accounts, and ownership authorization

Type: task
Status: open
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

None yet.
