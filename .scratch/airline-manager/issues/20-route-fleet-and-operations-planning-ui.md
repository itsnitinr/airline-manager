# Build route, fleet, timetable, fuel, workforce, maintenance, and weather planning UI

Type: task
Status: open
Blocked by: 09, 10, 11, 12, 13, 14, 15, 19

## Goal

Expose the slice-one operating decisions through a coherent desktop planning
experience backed only by real commands and forecasts.

## Scope

- Build fleet list/detail, lease obligations, aircraft condition, utilization,
  delivery, and maintenance views.
- Build map-led direct-route research with demand, competition, block time,
  weather, operating-cost, and expected-profit ranges.
- Build an economy pricing strategy editor with recommendations and guardrails.
- Build a recurring weekly timetable and single-aircraft rotation editor with
  effective dates and visual validation.
- Build fuel market, inventory, capacity-upgrade, purchase, burn forecast, and
  reserve controls.
- Build workforce capacity, hiring/training, qualification, wage, and shortage
  views.
- Build maintenance planning and weather/operational forecast views.
- Make complex editors desktop-first and provide intentional mobile read-only or
  bounded-action alternatives.

## Out of scope

- Connecting itineraries, cargo, premium cabins, station investments, or
  multi-aircraft optimization.
- Client-side calculations that override backend forecasts or validation.

## Acceptance criteria

- The player can create and activate a valid direct route and recurring rotation
  entirely through the web UI.
- Every blocked action identifies the constraint and links to a recovery path.
- Forecasts display ranges, provenance/explanation, and effective timestamps.
- Mobile users can monitor and perform the agreed safe actions without accessing
  an unusable compressed rotation editor.
- All mutations use typed generated API contracts and idempotency where needed.

## References

- ADR-0010: Timetables and rotations.
- ADR-0014: Assisted revenue management.
- ADR-0015: Global fuel inventory.
- ADR-0045 and ADR-0046: Visual and responsive boundaries.

## Comments

None yet.
