# Implement direct passenger demand, bookings, competition, and pricing

Type: task
Status: resolved
Blocked by: 05, 07, 08

## Goal

Create the slice-one commercial simulation for direct economy travel without
individual passenger agents or fully simulated AI airlines.

## Scope

- Model origin-destination travel markets, passenger segments, seasonality,
  market size, and aggregate competitor capacity/quality/fare pressure.
- Generate reproducible direct-demand curves from airport and world data.
- Model economy booking classes, pricing posture, base fare, bounds, and
  load-factor/revenue targets.
- Accumulate bookings from elapsed time and stored checkpoints rather than
  per-second jobs.
- Allocate demand to a dated flight using fare, departure time, duration,
  service, reputation, remaining seats, and aggregate competition.
- Preserve booking and realized-fare aggregates needed for flight settlement.
- Provide route-research, demand forecast, booking pace, load-factor, and yield
  queries with explanations.

## Out of scope

- Connecting itineraries.
- Premium cabins, loyalty programs, or individual travelers.
- Fully operated AI competitor airlines.

## Acceptance criteria

- The same inputs, seed, timestamp, and ruleset produce the same demand and
  booking result.
- Booking totals never exceed sellable cabin inventory.
- Higher prices, weaker schedules, and stronger competition affect relevant
  segments through testable explainable rules.
- Updating a pricing strategy is effective-dated and does not rewrite already
  accrued bookings.
- Completed-flight inputs retain realized fare and segment aggregates.

## References

- ADR-0011: Segmented aggregate passenger demand.
- ADR-0013: Aggregate single-player competition.
- ADR-0014: Assisted revenue management.
- ADR-0042: Direct economy scope for slice one.

## Comments

- Implemented version-bound directed playable-airport markets, documented business/leisure/VFR sensitivities, deterministic derived/balance demand and aggregate competition, assisted/effective-dated economy booking-class pricing, and a framework-independent opaque commercial-flight-offer boundary for ticket 12 without route/timetable/rotation records.
- Added serialized elapsed-time booking refresh with exact pricing-period splits, idempotent checkpoint retries, PostgreSQL capacity ceilings, exact minor-unit segment/class fare and revenue aggregates, immutable ticket-17 material-input snapshots, ownership checks, outbox events, and authenticated research/forecast/pricing/pace/load-factor/yield/mix/explanation APIs. No individual-passenger, full-AI-airline, or pre-settlement ledger revenue entity is created.
- Validation passed: frozen install; formatting, lint, eight boundary probes, OpenAPI/client and Kysely freshness, type-check, unit/property tests, build, Compose validation; blank and repeat migrations through 0010; 70 PostgreSQL plus 17 authenticated API integration tests; diff/ignored-file/provenance review; and Gitleaks history scan with no leaks. Working-directory scan findings were limited to ignored Next.js-generated `.next` keys and were not staged.
