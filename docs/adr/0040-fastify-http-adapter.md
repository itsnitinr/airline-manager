# ADR-0040: Use Fastify as the HTTP adapter

Status: accepted

## Context

The API needs schema-driven validation, serialization, and OpenAPI generation.
The domain layer must also run in simulation workers without requiring an HTTP
application or framework container.

Express would require more assembly for schema-first contracts. NestJS provides
more application conventions and dependency injection but would couple modules
more strongly to decorators and framework lifecycle than needed. Fastify offers
the desired HTTP facilities with a smaller application footprint.

## Decision

The backend API will use Fastify for HTTP routing, route-schema validation,
serialization, plugins, and OpenAPI integration. Fastify routes adapt requests
to framework-independent command and query services.

Simulation workers call those application services directly and do not start or
depend on a Fastify server.

## Consequences

- Route schemas can generate OpenAPI and typed client contracts.
- Application composition, module boundaries, and dependency injection remain
  project conventions rather than NestJS-provided structure.
- Fastify request and reply objects must not leak into domain or application
  interfaces.
- Transport-level performance is strong, but correctness and contract quality
  remain the primary reasons for the choice.
