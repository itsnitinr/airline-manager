# ADR-0042: Deliver production-quality vertical slices

Status: accepted

## Context

The full vision spans fleet, schedules, markets, passengers, cargo, fuel,
maintenance, workforce, airports, finance, weather, and persistent offline
processing. Attempting to complete every system before producing a playable
career would delay feedback and increase integration risk. A disposable
prototype would postpone the difficult backend and persistence work.

## Decision

Development will proceed through deployable vertical slices. Each slice uses the
production web, API, PostgreSQL database, ledger, worker, and domain boundaries
and adds a complete playable path rather than isolated horizontal scaffolding.

The first slice targets account creation, airline founding, a founder aircraft
lease, a curated reference-data subset, one direct passenger route and
recurring schedule, economy bookings, aggregate competition, global fuel
inventory, basic workforce, maintenance, generated weather, financial
settlement, and offline flight completion.

Connecting itineraries, dedicated cargo, premium cabins, station investment,
and full workforce depth are deferred to later slices.

## Consequences

- The first slice validates the hardest end-to-end lifecycle early.
- Feature breadth is intentionally incomplete during development but no core
  infrastructure is knowingly disposable.
- Every slice needs acceptance criteria, seed data, migrations, and integration
  tests.
- Later slices deepen existing modules without changing confirmed domain
  language or bypassing accepted invariants.
