# ADR-0044: Require authenticated ownership before airline founding

Status: accepted

## Context

Careers continue progressing offline and must survive browser changes, session
expiry, and device loss. Anonymous browser-owned state would create ambiguous
ownership and weak recovery, especially with future multiplayer support.

## Decision

A player must authenticate before founding or operating a persistent airline.
Slice one supports verified email/password accounts and Google sign-in, secure
server-managed sessions, password reset, and account recovery.

Anonymous persistent careers are excluded. A future non-persistent guided demo
may be implemented as a separate experience.

## Consequences

- Account and airline ownership boundaries exist from the first slice.
- Authentication secrets and provider tokens stay outside gameplay domain data.
- Authorization tests must prove that one account cannot read or command
  another account's airline.
- Account deletion, airline history retention, and future multi-airline ownership
  need explicit policies before public launch.
