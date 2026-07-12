# Background runtime

PostgreSQL is authoritative for outbox publication state, simulation milestones, replay audit,
timing, and gameplay outcomes. Redis and BullMQ are disposable at-least-once transport. Removing a
delayed Redis job does not remove its PostgreSQL milestone; reconciliation republishes overdue work
using the same deterministic identity.

## Envelope and handler contract

`JobEnvelopeV1` contains only command, entity, expected-version, correlation/causation, target-time,
handler identity, and bounded string routing fields. Unknown fields and routing keys associated with
money, passengers, snapshots, credentials, or secrets are rejected. Handlers are registered by
`handlerKind@handlerVersion`, reload authoritative state, and return an applied or safe no-op outcome.
Unsupported envelope or handler versions are quarantined without poison-message retry loops.

Replay is administrator-authorized and attributed. It reconstructs the retained safe envelope and
uses the normal versioned handler path; no force-mutation path exists.

## Delivery and reconciliation

- Outbox and milestone claimers use bounded `FOR UPDATE SKIP LOCKED` batches with explicit owners and
  expiring leases.
- Outbox publication retries use bounded exponential backoff. Published rows and redacted dead
  letters have bounded retention.
- BullMQ uses deterministic job IDs, authoritative target-time delay, bounded retries, stalled-job
  recovery, and configured concurrency.
- Reconciliation queries due PostgreSQL milestones and synchronizes the delivery, workforce,
  maintenance, and weather intent tables. It never uses the Redis job inventory as gameplay truth.

## Operations

The worker exposes `/health`, `/ready`, and Prometheus text at `/metrics`. Readiness includes
PostgreSQL/Redis connectivity and drain state. Metrics report bounded-label handler outcomes,
outbox/milestone backlog and lag, failures, reconciliation recovery, active work, and drain state.
Structured logs preserve command, correlation, and causation identifiers and redact credential-like
fields and values.

Configuration defaults:

- `WORKER_CONCURRENCY=8`
- `WORKER_DRAIN_MILLISECONDS=25000`
- `WORKER_POLL_MILLISECONDS=1000`

On `SIGTERM` or `SIGINT`, the worker pauses intake, stops new claims, drains active handlers within
the configured bound, safely releases any remaining PostgreSQL leases, closes BullMQ, and then
closes health and database resources.
