# ADR-0038: Use transactional state, an outbox, and settlement snapshots

Status: accepted

## Context

The system needs authoritative current state, reliable background work,
financial auditability, and reproducible completed-flight outcomes. Full event
sourcing would require replay semantics, event-version migrations, projections,
and careful handling of balance-rule changes across every domain.

Plain mutable tables without an outbox could lose jobs or notifications between
a database commit and queue publication.

## Decision

Normalized PostgreSQL tables store current authoritative game state. Important
transitions write domain events to a transactional outbox in the same database
transaction. Outbox delivery drives jobs, notifications, read models, and audit
consumers.

The financial ledger is immutable. Completed flights retain immutable snapshots
of the material inputs, ruleset versions, and settlement results. The system is
not fully event-sourced and does not rebuild whole airlines through event replay.

## Consequences

- State changes and event publication cannot diverge at commit time.
- Outbox consumers and queue jobs must be idempotent because delivery is at
  least once.
- Snapshot schemas and event schemas require versioning.
- Corrections use explicit adjusting transitions rather than overwriting ledger
  or settled-flight history.
