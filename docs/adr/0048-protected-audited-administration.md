# ADR-0048: Include protected audited administration in slice one

Status: accepted

## Context

Reference-data curation, balance publication, ruleset activation, failed-job
recovery, and persistent-state investigation are required to operate the game.
Performing them through ad hoc database edits would bypass domain invariants and
make corrections untraceable.

## Decision

Slice one includes a protected internal administration surface. Authorized
administrators can import, validate, compare, and promote reference data;
version derived and balance values; activate world rulesets; inspect airlines,
flights, schedules, jobs, notifications, and ledger entries; and safely retry
failed work.

Every administrative command records actor, time, reason, target, and outcome.
Settled flight snapshots and ledger entries cannot be silently edited;
corrections use explicit adjusting operations.

## Consequences

- Administration authorization is separate from ordinary player ownership.
- Sensitive reads and all writes require audit records.
- Job replay must use the same idempotent application services as normal worker
  delivery.
- The admin surface is production functionality and needs tests and access
  controls, even if its visual design is utilitarian.
