# Routes, timetables, and aircraft rotations

Ticket 12 owns researched direct routes, effective-dated weekly timetable versions, flight-leg templates, one-aircraft rotations, and generated dated flights. It does not execute flights or deliver queued work.

## Version and time semantics

- `scheduling-v1` is an immutable active scheduling ruleset tied to the career world ruleset and an explicit effective instant.
- Weekly inputs are local airport wall times. Generation resolves each service date through the airport IANA timezone, persists UTC departure/arrival/ready instants, and retains the resulting local displays.
- Nonexistent daylight-saving wall times are rejected with a correction. Ambiguous fall-back times deterministically select the earlier UTC occurrence.
- A timetable version starts prospectively. Replacement versions begin only after the active version's protected generated horizon, leaving every prior dated flight and commercial offer intact.
- Generation is limited to the ruleset horizon (56 days by default, 90 maximum), uses a per-aircraft transactional advisory lock, and relies on unique flight-template/service-date keys for retry safety.

## Validation and forecasts

Activation checks delivered-aircraft state, great-circle range, runway requirements, foreign-domestic cabotage, outsourced-service eligibility, local curfews, persisted hourly movement ceilings, leg chronology, required turnaround, aircraft position, and existing aircraft occupancy. Errors identify the failed rule and suggest a correction.

Distance, block time, turnaround, operating cost, and demand are deterministic provisional values. Their formula versions and inputs are retained with route and dated-flight snapshots; they are balance/derived simulation values rather than certified or live operating data.

PostgreSQL independently enforces non-overlap with an exclusion constraint over `[departure_at, ready_at)`. Commercially committed schedule facts are immutable, while later lifecycle tickets may advance status monotonically from scheduled through sold, in-progress, and settled.

## Integration boundaries

Each dated flight is published through ticket 11's opaque commercial-flight-offer port using the dated-flight UUID as the stable source reference. Retrying activation or horizon extension reuses the same offer. Ticket 12 also writes scheduling horizon intent to the transactional outbox, but ticket 16 remains responsible for delivery, BullMQ jobs, and reconciliation.
