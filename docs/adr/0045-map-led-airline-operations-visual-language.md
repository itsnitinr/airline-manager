# ADR-0045: Use a map-led airline operations visual language

Status: accepted

## Context

The game contains dense scheduling, fleet, market, maintenance, and financial
information. A raw spreadsheet presentation would make geography and network
strategy hard to perceive, while a cartoon or casino-like style would conflict
with the realism goal and reduce trust in operational signals.

## Decision

The interface will resemble a modern airline operations center. The network map
is a primary geographic anchor. Planning surfaces use strong information
hierarchy, charts, forecasts, restrained aviation-inspired typography, and a
premium visual system.

Status colors are reserved for meaningful operating conditions and required
actions. Decorative gamification, casino cues, and cartoon styling are excluded.
The interface must remain more legible and guided than a spreadsheet-only tool.

## Consequences

- Map, timetable, fleet, alerts, and forecasts become foundational design-system
  primitives.
- Dense screens require careful progressive disclosure and accessible color
  semantics.
- Visual polish cannot hide source, forecast, or consequence explanations.
- Responsive behavior needs an explicit decision because planning density may
  not translate directly to small screens.
