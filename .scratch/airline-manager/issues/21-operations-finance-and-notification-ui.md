# Build live operations, finance, and notification views

Type: task
Status: resolved
Blocked by: 07, 10, 17, 18, 19

## Goal

Let the player understand current operations, offline outcomes, financial health,
and required recovery actions on desktop and mobile.

## Scope

- Build an operations dashboard for active/upcoming flights, aircraft status,
  delay/suspension reasons, shortages, and maintenance alerts.
- Display flight detail and immutable settlement breakdown with inputs,
  realized outcomes, and attributed costs/revenue.
- Build simplified cash, runway, obligations, route profitability, and fuel
  inventory views.
- Add advanced profit-and-loss, balance-sheet, cash-flow, and journal views.
- Build the persisted notification center, unread state, filters, action links,
  browser opt-in, severity preferences, and quiet hours.
- Reconcile SSE updates with authoritative query refresh and offline recovery.
- Provide mobile monitoring plus agreed safe fuel and simple-pricing actions.

## Out of scope

- Editing ledger history.
- Email notification preferences.
- Native push delivery.

## Acceptance criteria

- A player returning after an offline flight can understand what happened and
  how every displayed financial result reconciles.
- Live updates never replace or contradict the authoritative refreshed state.
- Suspension and failure states show bounded consequences and actionable recovery.
- Advanced statements balance to the ledger.
- Mobile views expose alerts and safe recovery actions with accessible controls.

## References

- ADR-0027: Ledger-derived financial reporting.
- ADR-0031: Bounded offline failure.
- ADR-0036: Recoverable SSE.
- ADR-0047: Notification channels.

## Comments

### Information architecture and data refresh plan

- Keep the full-viewport network map and floating shell. Add Operations, Finance,
  and Notifications as real player destinations while leaving Administration
  absent. Operations uses a bounded chronological flight board plus map routes
  and a detail inspector; Finance uses an overview, ledger statements, and
  paginated journals; Notifications uses a filtered operational inbox and a
  separate browser-delivery preferences disclosure.
- Add three owner-scoped query boundaries only: a bounded operations board with
  offline changes and flight detail, ledger-derived finance overview/statements/
  journals with reconciliation assertions, and a paginated notification-center
  query with unread totals plus mark-one/mark-all. Reuse immutable settlement,
  ledger, fuel, lease/loan, and notification records rather than introducing
  parallel state or client aggregation.
- Fetch independent server projections in parallel and pass only displayed
  fields to client islands. Keep MapLibre deferred; dynamically load advanced
  finance/detail modules; derive filters during render and use transitions for
  non-urgent changes.
- Treat SSE as coalesced invalidation only. Persist the last event cursor, resume
  with the authorized stream, then refresh the relevant authoritative query.
  Display as-of, connected/reconnecting/offline/stale state and recover backlog
  after reconnect without applying event payloads to money, flight state, or
  unread totals.
- Repair notification read state at the persistence boundary so database and
  application clock skew cannot violate the current timestamp constraint, then
  cover read/unread, repeat updates, prior-schema migration, ownership, safe
  recovery routes, cursor replay, and duplicate projection behavior.

### Resolution

- Added bounded owner-scoped operations boards, offline transition summaries,
  settlement drilldowns, ledger-derived finance overview/statements/journals,
  and a persisted notification center. Operations, Finance, and Alerts now use
  the existing map shell on desktop and deliberate monitoring layouts on mobile;
  Administration remains absent.
- Fixed `markRead` at the root: `created_at` used PostgreSQL time while `read_at`
  used the application/test clock, so legitimate reads could violate
  `player_notifications_check` under clock skew. Both timestamps now use the
  database clock, migration 0019 replaces the anonymous check with
  `player_notifications_read_time_check`, and mark-one/mark-all plus ownership,
  repeat-read, blank, prior-schema, and repeat-migration cases are covered.
- Added recoverable cursor-based SSE invalidation with advisory payload handling,
  burst coalescing, authoritative refresh, offline/session/forbidden status, and
  persisted browser-delivery preferences with severity and IANA quiet hours.
  Heavy flight detail and advanced finance remain dynamic client islands while
  independent Server Component reads are parallelized.
- Validation: frozen install; format, lint, eight boundary rejections, all nine
  typechecks, 155 unit/component tests, production build, OpenAPI and Kysely
  freshness; 102 PostgreSQL database, 27 API, and 3 isolated worker integration
  tests; blank/prior/repeat migrations; fresh six-service Compose readiness; and
  all 25 serial real-stack Playwright journeys. Axe/reflow and inspected visual
  captures pass at 390x844, 768x1024, 1280x800, and 1600x1000, including reduced
  motion/transparency and 44px mobile targets.
