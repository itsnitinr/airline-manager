# Implement generated weather and operational flight planning

Type: task
Status: resolved
Blocked by: 05, 12

## Goal

Generate plausible forecast and realized conditions that influence block time,
fuel burn, congestion, and reliability without live weather feeds.

## Scope

- Add curated climate inputs sufficient for the slice-one airport catalog.
- Generate geographically and seasonally plausible weather systems from a
  deterministic world seed.
- Produce forecast snapshots with uncertainty and later realized-condition
  snapshots.
- Derive wind, visibility, runway-capacity, delay-risk, block-time, diversion,
  and fuel-burn modifiers within bounded rules.
- Expose route and departure forecasts to scheduling and player queries.
- Preserve the weather/ruleset inputs used for each settled flight.

## Out of scope

- Live weather providers.
- Detailed meteorological visualization or manual dispatcher routing.
- Fatal weather accidents.

## Acceptance criteria

- Identical world seed, location, ruleset, and time produce reproducible
  conditions.
- Forecasts may differ from realized conditions only through a defined seeded
  uncertainty process.
- Weather effects remain within documented physical and gameplay bounds.
- Route planning can explain expected block-time and fuel modifiers.
- No external weather API is required for the world to advance.

## References

- ADR-0030: Generated geographic weather.
- ADR-0051: Deterministic simulation testing.
- ADR-0017: No fatal safety outcomes.

## Comments

- 2026-07-12: Added published `slice-one-climate-v1` coverage and provenance for all 250
  playable airports; active immutable `weather-v1` rules; deterministic geographically correlated,
  seasonal forecast and seeded-realization logic; bounded wind, visibility, runway-capacity,
  congestion/delay, block-time, diversion, fuel-burn, and reliability modifiers; explainable
  immutable route/departure snapshots; realization checkpoint intent; and future ticket 17 material
  input boundaries without adding ticket 16 consumers or flight settlement.
- Added framework-independent domain/application contracts, PostgreSQL/Kysely persistence,
  authenticated owner-only REST queries, checked-in OpenAPI/client artifacts, and documentation.
  Validation passed frozen install; format, lint, eight boundary probes, typecheck, 49 domain tests
  including a 500-case invariant matrix, full unit suite and production build; 90 PostgreSQL and 25
  API integration tests; blank/repeat and 0014-to-0015 migrations; fresh 250-airport catalog seeds;
  Kysely/OpenAPI freshness; and a rebuilt healthy five-service Compose topology.
