# Implement slice-one qualified workforce capacity

Type: task
Status: resolved
Blocked by: 07, 08, 09, 12

## Goal

Make staffing a real operating constraint without introducing named employees or
manual rosters.

## Scope

- Model workforce pools by airline, base, role, and qualification.
- Support pilot type rating, cabin crew, line-maintenance, and ground-handling
  capacity needed by slice-one flights.
- Implement hiring, training lead time, wages, availability, and simple fatigue
  recovery using aggregated capacity.
- Provide founder recommendations and minimum viable staffing packages for each
  starter variant.
- Validate schedule staffing demand against qualified capacity and outsourced
  ground handling.
- Post hiring/training and recurring wage costs through the ledger.
- Forecast staffing shortages across the active timetable.

## Out of scope

- Named employees, personalities, résumés, or shift-by-shift rosters.
- Deep commercial departments or multi-base transfers.

## Acceptance criteria

- Flights cannot be dispatched without the required qualified capacity.
- A pilot pool cannot cover incompatible type ratings.
- Concurrent flights consume capacity without double allocation.
- Hiring and training become available only after their defined lead times.
- Wage and training postings reconcile to workforce state and ledger reports.

## References

- ADR-0018: Qualified workforce pools.
- ADR-0008: Capability-based progression.
- ADR-0031: Safe suspension on hard shortages.

## Comments

- 2026-07-12: Implemented versioned aggregate workforce pools by airline, principal base, role, and
  catalog-derived qualification; all four founder staffing packages; idempotent hiring with persisted
  training lead times/checkpoint intents; cohort-exact recurring wages; and balanced, reconcilable
  hiring/training/wage ledger journals. Slice-one demand covers type-rated pilots, cabin crew, line
  maintenance, and non-outsourced ground handling without creating employee or roster entities.
- Forecasts sweep active dated flights deterministically and return actionable base, role,
  qualification, window, required/available/shortfall, and correction details. The stable ticket-17
  readiness boundary locks dated flights and pools, atomically reserves duty plus fatigue-recovery
  capacity, rejects incompatible type ratings and concurrent double allocation, and intentionally does
  not invent a flight lifecycle or ticket-16 queue runtime.
- Validation passed frozen install (including Compose builds), formatting, lint, eight boundary probes,
  typecheck, 86 unit/property tests, full production build, 81 PostgreSQL integration tests, 21
  authenticated API integration tests, blank/repeat and ticket-12-to-ticket-13 migrations, repeat
  catalog seeding, generated Kysely/OpenAPI/client freshness, and a healthy fresh-volume five-service
  Compose topology. PostgreSQL coverage includes training catch-up, concurrent allocations, idempotent
  cohort accrual/posting, immutable rules, and exact workforce-to-ledger reconciliation.
