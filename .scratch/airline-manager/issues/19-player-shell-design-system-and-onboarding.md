# Build the player shell, design system, map, and onboarding

Type: task
Status: open
Blocked by: 01, 04, 05, 06, 08, 09

## Goal

Deliver the premium map-led operations shell and guide a new player from account
creation through airline and founder-aircraft selection.

## Scope

- Establish accessible typography, spacing, color, status semantics, forms,
  tables, charts, panels, empty/loading/error states, and responsive navigation.
- Build the authenticated application shell and network map using an open,
  provider-replaceable map adapter.
- Implement registration, verification, sign-in, recovery, and Google sign-in
  screens.
- Implement airline founding for brand, jurisdiction, principal base, reporting
  currency, equity/loan choice, and runway review.
- Implement founder-package comparison and lease selection.
- Use progressive explanations and viable recommendations without changing the
  one economic ruleset.
- Support desktop planning layouts and mobile onboarding/monitoring layouts.

## Out of scope

- Final route/timetable planner.
- Native mobile applications.
- Cartoon, casino, or decorative gamification patterns.

## Acceptance criteria

- A new player can reach an active airline and leased starter aircraft without
  direct API use.
- The map and all founding choices use real published catalog records.
- Keyboard navigation, focus behavior, color contrast, and reduced-motion
  behavior meet the chosen accessibility baseline.
- Mobile supports the complete onboarding flow without exposing complex desktop
  planners.
- Error states preserve input and explain recovery without leaking backend
  internals.

## References

- ADR-0003: Progressive disclosure.
- ADR-0044: Authenticated ownership.
- ADR-0045: Map-led operations visual language.
- ADR-0046: Desktop planning and mobile monitoring.

## Comments

None yet.
