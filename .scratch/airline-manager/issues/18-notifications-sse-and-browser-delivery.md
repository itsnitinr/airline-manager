# Implement persisted notifications, SSE, and browser delivery

Type: task
Status: resolved
Blocked by: 04, 16, 17

## Goal

Make persistent operational and financial events visible in real time and after
reconnection without making delivery a simulation dependency.

## Scope

- Model notification intents, persisted player notifications, severity, read
  state, deduplication key, related resource, and recovery action.
- Consume outbox events to create notifications idempotently.
- Complete authorized SSE delivery with heartbeat, event IDs/cursors, reconnect,
  backlog recovery, and per-account filtering.
- Add browser-notification permission and delivery behind explicit player opt-in.
- Implement severity preferences and quiet hours.
- Cover flight delay, suspension, cancellation, arrival/settlement, fuel
  shortage, maintenance due/fault, aircraft delivery, and financial obligation
  events required by slice one.

## Out of scope

- Email, SMS, or native push notifications.
- Notification receipt as proof that a backend transition occurred.

## Acceptance criteria

- A disconnected client sees all persisted notifications after reconnect.
- SSE never leaks another player's events and resumes without duplication.
- Browser permission denial leaves the in-game center fully functional.
- Duplicate outbox delivery creates one player notification.
- Quiet hours affect browser delivery only, not persistence or safe suspension.

## References

- ADR-0036: Recoverable SSE.
- ADR-0047: Persisted in-game and browser notifications.
- ADR-0031: Backend safety independent of notifications.

## Comments

- 2026-07-13: Added persisted, owner-scoped notification intents, player notifications, stable
  deduplication/event cursors, severity/read/recovery metadata, preferences, quiet hours, and account,
  aircraft, fuel, maintenance, workforce, finance, and complete flight-lifecycle projections from the
  transactional outbox. The worker now creates notifications idempotently; authenticated SSE replays
  backlog by cursor or `Last-Event-ID`, polls for new persisted events, heartbeats, and filters per
  player; minimal browser plumbing requests permission only after opt-in and applies severity and
  quiet-hour policy without affecting authoritative simulation state.
- Validation passed frozen install, formatting, lint, eight boundary probes, typecheck, 116 unit
  tests, production build, blank/repeat and 0017-to-0018 migrations, Kysely and OpenAPI/client
  freshness, 100 PostgreSQL plus 27 API integration tests, 3 real Redis/BullMQ suites, concurrent
  exact-once replay and ownership-isolation coverage, authenticated SSE backlog/resume/reconnect/
  heartbeat/leakage coverage, browser permission/preference/quiet-hour coverage, and a fresh-volume
  healthy five-service Compose rebuild with API and worker readiness.
