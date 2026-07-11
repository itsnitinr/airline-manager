# ADR-0011: Simulate segmented aggregate passenger demand

Status: accepted

## Context

Individual passenger agents could express detailed preferences but would create
large amounts of state and computation that are mostly invisible to the player.
A single demand number per route would be efficient but too shallow to model
the different responses of business, leisure, and other traveler groups.

## Decision

Passenger demand will be aggregated by origin-destination travel market, market
segment, and cabin. Bookings will accumulate against specific future flights
and respond to price, schedule, duration, service, and airline reputation.
Individual passengers will not be persisted as simulation entities.

## Consequences

- The simulation can represent meaningful traveler preferences without
  millions of passenger records.
- Demand generation and booking allocation remain separate concerns.
- Booking snapshots or aggregates must preserve enough history to settle
  completed flights reproducibly.
- Player-facing explanations should identify which segments a schedule and fare
  attract or lose.
