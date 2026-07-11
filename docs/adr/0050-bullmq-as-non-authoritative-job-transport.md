# ADR-0050: Use BullMQ as non-authoritative job transport

Status: accepted

## Context

The simulator needs delayed milestone delivery, retries, backoff, stalled-job
recovery, deduplication, and recurring reconciliation. Redis is already part of
the accepted topology. Queue delivery can be late, duplicated, or interrupted,
so it cannot determine authoritative flight or financial state.

## Decision

BullMQ will transport delayed and asynchronous work. Job payloads contain entity
identifiers, command identity, and expected versions rather than authoritative
state. Workers re-read PostgreSQL, verify eligibility, and call idempotent
application services inside database transactions.

Periodic reconciliation is scheduled through the same worker environment but
derives overdue work from PostgreSQL rather than trusting the queue inventory.

## Consequences

- Duplicate, stale, and late jobs must converge to a no-op or the same committed
  result.
- Queue retention can be bounded because PostgreSQL and the outbox preserve
  recovery information.
- Worker concurrency, retry, backoff, dead-letter review, and graceful draining
  need operational configuration.
- BullMQ timing is not used as proof that a flight departed or arrived.
