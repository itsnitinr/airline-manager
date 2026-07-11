# Implement routes, recurring timetables, and aircraft rotations

Type: task
Status: open
Blocked by: 05, 09, 11

## Goal

Allow the player to research a direct route, build a recurring weekly timetable,
and assign one aircraft through a physically coherent rotation.

## Scope

- Model routes, weekly timetable versions, flight-leg templates, rotations,
  effective dates, turnaround, and generated dated flights.
- Validate aircraft range/performance, runway compatibility, curfews, simplified
  traffic rights, congestion ceilings, chronology, overlap, and aircraft
  position continuity.
- Support outsourced service at eligible airports without requiring station
  investment.
- Calculate distance, planned block time, turnaround, and provisional operating
  cost/demand forecasts.
- Generate future dated flights only inside a bounded scheduling horizon and
  extend it idempotently.
- Prevent timetable edits from rewriting sold, in-progress, or settled flights.
- Return actionable validation errors and suggested corrections.

## Out of scope

- One-stop passenger itineraries.
- Player-owned airport slots or additional operating bases.
- Automated multi-aircraft optimization.

## Acceptance criteria

- An invalid rotation cannot be activated.
- The database and domain tests prevent overlapping assignment of one aircraft.
- Timezone and daylight-saving transitions generate correct UTC instants and
  local timetable displays.
- Re-running flight generation cannot duplicate dated flights.
- Schedule version changes take effect prospectively and preserve prior flights.

## References

- ADR-0010: Recurring timetables and aircraft rotations.
- ADR-0022: Congestion without player-managed slots.
- ADR-0023: Simplified traffic rights.
- ADR-0002: Server-authoritative persistent time.

## Comments

None yet.
