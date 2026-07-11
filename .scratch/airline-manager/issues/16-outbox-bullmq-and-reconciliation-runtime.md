# Implement outbox delivery, BullMQ workers, and reconciliation

Type: task
Status: open
Blocked by: 03, 04

## Goal

Provide reliable at-least-once background delivery while keeping PostgreSQL
authoritative and every simulation transition retry-safe.

## Scope

- Implement transactional outbox claiming, publication, retry, and retention.
- Configure BullMQ queues, delayed jobs, retry/backoff, stalled handling,
  concurrency, deduplication, and dead-letter inspection.
- Define versioned job envelopes carrying command ID, entity ID, expected
  version, correlation/causation ID, and target time.
- Implement worker lifecycle, graceful drain, structured logs, and metrics.
- Implement database-driven reconciliation that finds overdue milestones without
  trusting Redis inventory.
- Provide generic milestone registration and handler interfaces used by
  delivery, flights, maintenance, contracts, and notifications.
- Add admin-safe replay primitives that call the same idempotent handlers.

## Out of scope

- Flight-specific state transitions, implemented in ticket 17.
- Queue state as proof of any gameplay outcome.

## Acceptance criteria

- A committed outbox row is eventually published after transient Redis failure.
- Duplicate, stale, and delayed jobs safely no-op or converge on one result.
- Reconciliation restores deliberately removed delayed work from PostgreSQL.
- Worker shutdown stops new claims, finishes or safely releases active work, and
  records lag/readiness correctly.
- Queue payloads contain no authoritative money totals or secret data.

## References

- ADR-0038: Transactional outbox.
- ADR-0039: Milestones and reconciliation.
- ADR-0050: BullMQ as non-authoritative transport.
- ADR-0052: Operational observability.

## Comments

None yet.
