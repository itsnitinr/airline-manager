# Build the PostgreSQL and Kysely persistence foundation

Type: task
Status: resolved
Blocked by: 01, 02

## Goal

Provide explicit SQL migrations, generated database types, safe transaction
helpers, and the persistence conventions used by every domain module.

## Scope

- Configure PostgreSQL connectivity and pooling for API, worker, tests, and
  migrations.
- Implement forward SQL migrations with a production-safe migration runner.
- Generate Kysely database types from the applied schema.
- Define conventions for UUIDs, timestamps, exact decimal/money values,
  optimistic versions, and UTC storage.
- Add base tables for migration metadata, transactional outbox, idempotency
  commands, and administrative audit records.
- Implement short transaction helpers with selectable isolation levels and
  retry behavior for recognized serialization/deadlock errors.
- Add repository interfaces so Kysely row shapes do not enter domain APIs.

## Out of scope

- Gameplay-specific entities.
- Queue publication or outbox consumption.
- Financial chart of accounts.

## Acceptance criteria

- A blank database migrates to current and type generation is reproducible.
- CI detects unapplied migrations and stale generated types.
- Migration SQL can use PostgreSQL-native indexes and constraints.
- Transaction tests prove rollback, isolation selection, and safe retry.
- Outbox, idempotency, and admin-audit base rows have database-enforced keys.

## References

- ADR-0041: Kysely with explicit PostgreSQL migrations.
- ADR-0038: Transactional state, outbox, and settlement snapshots.
- ADR-0028: Multi-currency ledger and exact money representation.

## Comments

- 2026-07-11: Added bounded UTC PostgreSQL pools for API, worker, tests, and migrations;
  an advisory-locked, checksummed forward SQL migration runner; reproducible generated Kysely
  types; domain-owned repository interfaces; short selectable-isolation transactions with retry
  limited to PostgreSQL serialization/deadlock failures; and constrained/indexed migration,
  outbox, idempotency, and append-only administrative-audit tables. CI now proves pending migration
  detection, blank migration, repeat no-op behavior, current generated types, and real-PostgreSQL
  integration tests. Validation passed for frozen install, formatting, lint/boundaries, type-check,
  23 unit tests, build, 10 PostgreSQL integration tests, transaction rollback/isolation/retry,
  constraint/index enforcement, reproducible and deliberately stale type generation, clean-volume
  Compose migration/readiness/outage recovery, graceful shutdown, ignored state, diff/whitespace,
  and public-repository secret scanning.
