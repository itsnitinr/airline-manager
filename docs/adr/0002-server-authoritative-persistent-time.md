# ADR-0002: Use server-authoritative persistent time

Status: accepted

## Context

The game must decide whether its world pauses between player sessions or keeps
operating. This affects flight execution, fuel use, maintenance, finances,
offline reliability, and the future multiplayer model.

## Decision

Simulation time continues while the player is offline. The backend is the
authority for current time and the state transitions caused by elapsed time.
The browser displays and submits player decisions but does not determine how
much simulation time has passed.

Flight operations use an approximately 1:1 relationship with real-world block
time. An eight-hour operation therefore occupies its assigned aircraft for
roughly eight real hours. Long-horizon systems such as aircraft aging remain a
separate unresolved decision and are not implicitly fixed to the same scale.

## Consequences

- Flights and other scheduled operations can complete without an open browser.
- Scheduled state must be persisted and processing must be idempotent so jobs
  can safely resume or retry.
- Players can return to changed operational and financial state.
- Aircraft utilization and route duration create real scheduling opportunity
  costs rather than being compressed for faster sessions.
- Offline outcomes need clear limits, forecasts, and notifications to avoid
  surprising or punitive experiences.
- The time authority is compatible with a future shared multiplayer world.
