# ADR-0041: Use Kysely with explicit PostgreSQL migrations

Status: accepted

## Context

The game needs exact ledger transactions, an outbox, reconciliation queries,
row locking, partial and compound indexes, strong constraints, reporting, and
potentially other PostgreSQL-native features. A high-level ORM would simplify
ordinary CRUD but require frequent escape hatches for important behavior.

Drizzle provides SQL-like queries and integrated TypeScript schema tooling, but
the project prefers PostgreSQL to remain the schema authority and wants to
minimize dependency on evolving ORM schema APIs.

## Decision

The backend will use Kysely as its type-safe SQL query builder. Database types
are generated from the applied PostgreSQL schema. Schema evolution uses
explicit, reviewed SQL migrations rather than ORM-generated model diffs.

Kysely is a persistence adapter and must not leak database row shapes into the
domain model.

## Consequences

- Engineers need working SQL and PostgreSQL knowledge.
- Database constraints and locking semantics remain visible and reviewable.
- Type generation must run after migrations and be checked in or reproduced
  consistently in CI.
- Migration rollback and forward-fix policy must be explicit for production.
- Repository interfaces isolate domain services from query-builder details.
