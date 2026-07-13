# Build route, fleet, timetable, fuel, workforce, maintenance, and weather planning UI

Type: task
Status: resolved
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

### Implementation plan

- Keep the full-screen network map as the geographic anchor and turn the floating
  rail into honest Network, Fleet, Fuel, Workforce, and Maintenance destinations;
  operations, finance, and notifications remain unavailable for ticket 21.
- Use a route-research inspector for accessible origin, destination, and aircraft
  selection, then open desktop-only pricing and weekly-rotation workbenches that
  preserve map context. Mobile retains read-only planning summaries plus bounded
  simple pricing and fuel actions.
- Present fleet, fuel, workforce, maintenance, and weather through aligned tables,
  timelines, forecast ranges, and contextual recovery links rather than dashboard
  card grids. Every value comes from the ticket 09-15 APIs and carries explicit
  fact, derived-forecast, or balance provenance where applicable.
- Add only narrow planning read models for authoritative route economics and the
  active timetable/dated-flight summary; centralize typed web adapters and stable
  idempotency handling, then refresh authoritative reads after commands.

### Resolution

- Shipped owner-scoped fleet detail; map-led route research and authoritative
  economics; prospective economy pricing; recurring single-aircraft timetable
  validation/activation; fuel, workforce, maintenance, and generated-weather
  planning; and intentional mobile monitoring/safe-action boundaries. Ticket 21
  destinations remain visibly deferred and unavailable.
- Added only two narrow reads: fleet planning detail with lease obligations and a
  route-planning snapshot with backend-composed economics, timetable horizon, and
  provenance. OpenAPI and the typed generated client are current; no schema
  migration was required.
- Validation: frozen install, format, lint, boundary checks, all typechecks/unit
  tests/builds, contract and Kysely freshness, blank/repeat migrations, fresh
  Compose readiness, 44 affected database tests, 18 affected API tests, 3 real
  Redis/worker tests, and all 11 Playwright journeys passed. Axe passed the four
  required viewports plus 200% equivalent reflow; keyboard, dialog focus, reduced
  motion/transparency, map degradation, and 44 px mobile targets were exercised.
  Visual QA covered happy, warning, constraint, confirmation, empty, loading, and
  mobile handoff states. A local shell sample measured LCP 536 ms and CLS 0.0087;
  the 1.04 MB MapLibre renderer remains a deferred chunk.
- Real-stack browser constraints cover range, rotation overlap, aircraft position,
  and maintenance/workforce recovery. Runway and curfew corrections are covered
  by domain and component tests because the published slice has no
  runway-incompatible airport and its immediately delivered founder aircraft
  cannot reach the three curfew-rule airports; no catalog facts or delivery clocks
  were altered to manufacture those cases.
- The full database suite remains 100/101: the unchanged ticket-21 notification
  projection test fails in `markRead` on `player_notifications_check`. No ticket-20
  affected suite fails, and notification code was not changed here.
