# Implement routes, recurring timetables, and aircraft rotations

Type: task
Status: resolved
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

- 2026-07-12: Implemented researched direct routes, immutable effective-dated weekly timetable versions, flight-leg templates, one-aircraft rotations, versioned airport scheduling rules, and bounded dated-flight generation. Validation covers delivery state, range, runway, outsourced-service eligibility, simplified cabotage, local curfews, persisted congestion ceilings, chronology, turnaround, aircraft position, and aircraft occupancy; errors include suggested corrections. Deterministic versioned distance, block-time, turnaround, congestion-adjusted cost, and ticket-11 demand forecasts are retained as snapshots.
- Dated-flight generation uses IANA local-wall-time conversion with DST gap/ambiguity handling, per-aircraft transactional locks, unique service-date keys, a PostgreSQL occupancy exclusion constraint, monotonic historical status protection, prospective version boundaries, and idempotent horizon extension. Generated flights bind through ticket 11's opaque commercial-offer port; ticket 12 persists outbox intent without adding ticket 16 queue consumers.
- Validation passed frozen install, formatting, lint, eight boundary probes, type-check, 31 domain/unit tests, full build, generated Kysely and OpenAPI/client freshness, blank/repeat and prior-schema migrations, 76 PostgreSQL integration tests, 19 authenticated API integration tests, and a rebuilt healthy five-service Docker Compose topology. Staged diff, whitespace, ignored-file, and public-repository secret review completed before the focused local commit.
