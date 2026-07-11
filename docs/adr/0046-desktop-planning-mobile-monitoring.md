# ADR-0046: Optimize desktop for planning and mobile for monitoring

Status: accepted

## Context

Weekly rotations, route comparison, network maps, fleet utilization, and
financial analysis need substantial screen space. Forcing identical complex
editing onto a phone would reduce legibility and increase destructive scheduling
errors. Persistent offline progression still makes mobile monitoring valuable.

## Decision

The initial product is a responsive web application optimized for desktop and
laptop planning. Mobile web supports monitoring, alerts, fuel purchases, simple
pricing changes, and other bounded safe actions.

Complex aircraft-rotation editing on small screens and native mobile
applications are deferred.

## Consequences

- Responsive design is required, but feature presentation may differ by
  viewport rather than merely shrinking.
- Unsupported mobile editing actions need clear handoff or read-only states.
- Critical alerts and recovery actions remain reachable on mobile.
- Desktop keyboard navigation and mobile touch targets both require explicit
  accessibility testing.
