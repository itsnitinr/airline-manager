# Implement the persistent flight lifecycle and settlement

Type: task
Status: resolved
Blocked by: 10, 11, 12, 13, 14, 15, 16

## Goal

Complete the central vertical slice from a scheduled future flight through
offline departure, arrival, operational effects, financial settlement, and an
immutable outcome snapshot.

## Scope

- Define explicit flight states for scheduled, suspended, cancelled, delayed,
  boarding/locked, departed, diverted, arrived, and settled.
- Freeze material booking, pricing, aircraft, staffing, maintenance, fuel,
  weather, airport, and ruleset inputs at appropriate milestones.
- Revalidate hard dispatch requirements and apply bounded automatic suspension
  on shortages or unsafe conditions.
- Consume global fuel, qualified workforce capacity, aircraft utilization, and
  maintenance counters exactly once.
- Compute realized block time, delay, bookings carried, revenue, refunds,
  airport/handling cost, fuel cost, wages, maintenance allocation, and result.
- Post settlement to the double-entry ledger atomically with authoritative
  flight state and outbox events.
- Persist an immutable settled-flight snapshot and expose an explainable result.
- Support late worker execution by advancing all eligible overdue milestones in
  order without changing the result.

## Out of scope

- Connections, cargo, premium cabins, or fatal incidents.
- Manual in-flight control.

## Acceptance criteria

- A flight completes and settles while the browser and API are offline.
- Retrying every milestone cannot duplicate fuel use, hours/cycles, bookings,
  notifications, or ledger postings.
- The aircraft location and availability remain continuous across the rotation.
- Hard shortages suspend safely and create bounded refunds/cost/reputation
  effects.
- Settlement reports reconcile to ledger, inventory, aircraft, and booking
  aggregates.
- A settled snapshot is immutable and reproducible from stored inputs and
  ruleset versions.

## References

- ADR-0002: Persistent server-authoritative time.
- ADR-0031: Bounded offline operational failure.
- ADR-0038: Settlement snapshots.
- ADR-0039: Milestone-driven simulation.
- ADR-0042: Production vertical slice.

## Comments

- 2026-07-13: Added the version-guarded scheduled/suspended/cancelled/delayed/boarding/departed/diverted/arrived/settled state machine; deterministic booking-lock, dispatch, arrival, and settlement milestones; PostgreSQL-driven catch-up/reconciliation; bounded shortage recovery; exact-once booking, fuel, workforce, aircraft-location/utilization, maintenance, ledger, and outbox effects; staged material freezes; immutable settlement snapshots; and owner-only status/timeline/recovery/settlement APIs.
- Validation passed frozen install, formatting, lint, eight boundary probes, typecheck, 108 unit tests, production build, blank/repeat/prior-schema migrations, Kysely and OpenAPI/client freshness, 97 PostgreSQL plus 27 API integration tests, 3 real Redis/BullMQ tests, deleted-Redis-job offline flight completion with API/browser absent, and a fresh-volume healthy five-service Compose rebuild.
