# Implement the Fastify API and worker application shells

Type: task
Status: open
Blocked by: 01, 03

## Goal

Create stable transport and application boundaries before gameplay endpoints are
added.

## Scope

- Configure Fastify plugins for request IDs, structured logging, error mapping,
  security headers, CORS, rate-limit hooks, and request validation.
- Define versioned REST routing and generate an OpenAPI document.
- Generate or validate a typed web client from the OpenAPI contract.
- Establish command and query handler interfaces independent of Fastify.
- Implement health and readiness endpoints for API and worker processes.
- Define standard error envelopes, pagination, idempotency-key handling, and
  authorization context placeholders.
- Provide an SSE endpoint shell with heartbeat, cursor, reconnect, and
  authorization hooks; persistence arrives in ticket 18.

## Out of scope

- Player authentication implementation.
- Gameplay commands and queries.
- BullMQ consumers.

## Acceptance criteria

- Invalid requests are rejected from route schemas before domain handlers run.
- The generated OpenAPI document is deterministic and checked in CI.
- A sample command can be invoked from HTTP and directly from a worker-facing
  application service without Fastify types crossing the boundary.
- Health/readiness and error responses are covered by integration tests.
- Logs correlate request, command, and database transaction identifiers without
  including request secrets.

## References

- ADR-0036: REST/OpenAPI and recoverable SSE.
- ADR-0040: Fastify HTTP adapter.
- ADR-0037: Modular monolith backend.

## Comments

None yet.
