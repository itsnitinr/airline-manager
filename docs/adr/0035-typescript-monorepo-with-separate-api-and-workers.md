# ADR-0035: Use a TypeScript monorepo with separate API and workers

Status: accepted

## Context

The product needs a web client, real backend, durable database, and persistent
offline simulation. Running all simulation work inside web request handlers or
Next.js routes would couple long-running state transitions to request lifetimes
and deployment behavior.

Using one language and repository can simplify shared contracts, validation,
tooling, and contributions.

## Decision

The system will be a TypeScript monorepo containing separate applications for:

- A Next.js web client.
- A TypeScript backend API.
- One or more background simulation workers.

PostgreSQL is the authoritative store. Redis-backed job processing coordinates
scheduled and asynchronous work but is not authoritative game state. Shared
packages contain contracts, validation, and deterministic domain logic without
collapsing application deployment boundaries.

## Consequences

- Web deployment failure does not stop already-scheduled simulation workers.
- API and workers can scale and deploy independently.
- Database transactions and idempotency protect authoritative transitions from
  duplicate job delivery.
- Monorepo boundaries and dependency rules must prevent web code from directly
  importing backend persistence internals.
- A local development environment needs PostgreSQL and Redis services.
