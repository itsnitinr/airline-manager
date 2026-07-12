# Implement outbox delivery, BullMQ workers, and reconciliation

Type: task
Status: resolved
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

- 2026-07-12: Implemented strict versioned safe-routing envelopes, deterministic BullMQ identity,
  bounded retries/stalled recovery, PostgreSQL `SKIP LOCKED` outbox and milestone leases, failure and
  retention state, redacted dead letters, attributed same-handler replay, and authoritative
  reconciliation for generic plus existing aircraft-delivery, workforce, maintenance, and weather
  intents. The worker now provides configurable concurrency, delayed delivery, correlated redacted
  logs, lag/outcome metrics, dependency/drain readiness, and bounded signal-driven drain with lease
  recovery; no ticket 17 flight transitions, ticket 18 notification delivery, or ticket 22 UI were
  added.
- Validation passed frozen install, formatting, lint, eight boundary probes, typecheck, 105 unit
  tests, production build, OpenAPI/client and Kysely freshness, fresh blank/repeat and 0015-to-0016
  migrations, 95 PostgreSQL plus 25 authenticated API integration tests, and 2 isolated real
  Redis/BullMQ lifecycle suites covering retry, duplicate delivery, poison quarantine, replay audit,
  and restoration of deliberately deleted delayed work. Fresh Compose images reached healthy
  readiness; worker metrics were inspected and SIGTERM drain/restart completed within the bound.
