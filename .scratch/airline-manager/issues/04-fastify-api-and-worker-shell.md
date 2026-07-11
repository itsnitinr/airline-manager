# Implement the Fastify API and worker application shells

Type: task
Status: resolved
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

- 2026-07-11: Added a Fastify transport shell with UUID request correlation, structured
  secret-redacted logs, validation, standard errors, security headers, bounded CORS and rate
  limiting; versioned REST routes; deterministic checked OpenAPI and generated client types;
  a typed fetch client; framework-independent command/query interfaces and shared sample-command
  execution from HTTP and worker code; preserved API/worker health and dependency readiness; and
  a cursor-aware, reconnectable SSE shell with heartbeat and authorization hooks. Validation
  passed for frozen install, formatting, lint and dependency boundaries, contract drift, type-check,
  36 unit tests, all builds, production API/worker/migration images, the complete Compose topology,
  10 real-PostgreSQL integration tests, current migrations and generated Kysely types, live command
  invocation, Redis outage/recovery readiness, graceful SIGTERM exits, diff checks, and public-repo
  secret scanning.
