# Implement generated weather and operational flight planning

Type: task
Status: open
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

None yet.
