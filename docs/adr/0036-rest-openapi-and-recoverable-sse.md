# ADR-0036: Use REST/OpenAPI with recoverable SSE updates

Status: accepted

## Context

The web client needs clear state-changing operations, dashboard queries, and
live updates for persistent simulation events. A bidirectional socket protocol
or GraphQL would add operational and authorization complexity before the query
shape demands it.

## Decision

The backend exposes versioned REST endpoints documented with OpenAPI. Mutations
are explicit domain commands, while query endpoints may return read models
optimized for planning and dashboards.

Server-Sent Events provide live notifications about flights, maintenance,
deliveries, and other state changes. SSE is advisory: a reconnecting client
reloads or resumes from persisted authoritative state and does not depend on
receiving every transient event. GraphQL is deferred.

## Consequences

- OpenAPI generation keeps client types aligned with backend validation.
- Commands need idempotency keys where retries could duplicate economic actions.
- SSE needs authorization, cursor or event identifiers, heartbeat, and reconnect
  behavior.
- Query endpoints can evolve independently from normalized write models while
  retaining a stable versioned contract.
