# Implement direct passenger demand, bookings, competition, and pricing

Type: task
Status: open
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

None yet.
