# ADR-0037: Begin with a modular monolith

Status: accepted

## Context

Fleet, scheduling, operations, maintenance, workforce, markets, fuel, and
finance have strong consistency requirements. Splitting them into early
microservices would introduce distributed transactions, duplicated contracts,
network failure modes, and operational overhead before independent scaling is
demonstrably needed.

An unstructured monolith would make future extraction and domain reasoning
difficult.

## Decision

The backend will be a modular monolith with explicit domain modules for
identity, airlines, fleet, scheduling, markets, operations, maintenance,
workforce, fuel, finance, and supporting concerns. Modules expose application
interfaces and do not reach into each other's persistence internals.

The API and simulation workers are separate process entry points using the same
domain modules and PostgreSQL database. A module becomes an independent service
only after concrete scaling or ownership evidence supports extraction.

## Consequences

- Cross-module operations can use local database transactions and an outbox.
- Module boundaries need dependency rules and contract tests even though the
  code is co-located.
- API and workers must share idempotent application services rather than
  duplicate business rules.
- Deployment remains simpler than a distributed system while preserving a
  deliberate extraction path.
