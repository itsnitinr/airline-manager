# ADR-0047: Persist game notifications and optionally deliver them in-browser

Status: accepted

## Context

Persistent offline progression creates important events while the player is
away. Notification delivery can fail or be denied, so safety and state recovery
cannot depend on a browser receiving a message. Email adds deliverability,
preference, template, and compliance work that is not required for the first
playable lifecycle.

## Decision

Operational, financial, and account events create persisted in-game
notifications. Players may optionally enable browser notifications and configure
severity and quiet hours.

Email notifications are deferred from slice one. Notification delivery is
advisory; authoritative state and automatic safe suspension remain effective
without it.

## Consequences

- Notifications need read state, severity, deduplication, and links to recovery
  actions.
- Browser permission denial is a normal supported state.
- SSE can announce new persisted notifications but is not their storage.
- A future email channel can consume the same notification intents and player
  preferences.
