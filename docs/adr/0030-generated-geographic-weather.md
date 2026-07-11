# ADR-0030: Generate plausible weather instead of using live feeds

Status: accepted

## Context

Weather is essential to realistic airline reliability, fuel use, and schedule
planning. Live weather would couple game progression to external API
availability and could make regions predictably advantaged or disadvantaged by
current real-world events.

Pure random delay penalties would be difficult to anticipate or explain.

## Decision

The game will generate geographically and seasonally plausible weather with
forecast uncertainty. Conditions may affect wind, visibility, runway capacity,
block time, fuel burn, delays, diversions, and cancellations. Players receive
forecasts and can plan buffers.

The simulation will not synchronize operational outcomes from live weather
feeds.

## Consequences

- Weather generation is deterministic or reproducible from persisted state so
  retries do not change settled outcomes.
- Airports need climate and operational sensitivity reference inputs.
- Forecast accuracy and horizon become gameplay parameters.
- Disruption explanations can point to recorded conditions rather than an
  arbitrary random modifier.
