# Harden, verify, and release the first playable slice

Type: task
Status: open
Blocked by: 17, 18, 20, 21, 22

## Goal

Prove the complete slice-one career is deterministic, secure, observable,
recoverable, balanced, and ready for a controlled public deployment.

## Scope

- Complete deterministic unit and property-based invariant suites.
- Add PostgreSQL/Redis integration tests for transactions, outbox, queue,
  concurrency, retries, and reconciliation.
- Add browser end-to-end coverage from registration through airline founding,
  founder lease, route activation, offline flight completion, settlement,
  notification, and recovery.
- Add replay tests for duplicate, stale, late, reordered, and manually retried
  jobs.
- Create fixed balance scenarios for all four starter variants and representative
  short/medium routes, including failure/recovery cases.
- Complete structured logs, traces/correlation, metrics, dashboards, alerts,
  health/readiness, and operational runbooks.
- Perform authorization, rate-limit, secret-handling, dependency, container,
  migration, backup/restore, accessibility, responsive, and performance reviews.
- Document deployment, rollback, worker drain, reconciliation, data publication,
  and incident response.
- Select production hosting only after recording budget and operational criteria.

## Out of scope

- Connections, cargo, premium cabins, advanced stations/workforce, multiplayer,
  native apps, or email notifications.

## Acceptance criteria

- The founding-to-settlement end-to-end test passes with the browser closed
  during flight execution.
- Ledger, inventory, aircraft, booking, schedule, and notification invariants
  hold under failure injection and concurrency.
- Every critical metric has a dashboard, actionable alert, and runbook.
- Backup restore and migration rollback/forward-fix procedures are exercised.
- Secret scanning and authorization tests pass with no known high-severity issue.
- Accessibility and supported viewport checks pass for agreed slice-one flows.
- A release checklist documents remaining known limitations and explicitly
  confirms every deferred feature.

## References

- ADR-0042: Production-quality vertical slices.
- ADR-0049: Provider-neutral deployment.
- ADR-0051: Deterministic invariant-driven testing.
- ADR-0052: Observability from slice one.

## Comments

None yet.
