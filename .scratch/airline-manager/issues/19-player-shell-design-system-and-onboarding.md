# Build the player shell, design system, map, and onboarding

Type: task
Status: resolved
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

- 2026-07-13 design read: desktop-first airline operations product for aviation
  enthusiasts, using a restrained premium operations-center language with a
  dark cartographic canvas, disciplined information density, guided onboarding,
  and an intentional mobile monitoring shell. Dials are design variance 5,
  motion intensity 3, and visual density 7.
- Token and interaction plan: use semantic near-black/navy surfaces, hierarchical
  text and borders, one cool cyan-blue action/focus accent, status colors only
  for nominal/warning/critical conditions, compact sans interface type plus
  tabular mono numerals, a consistent 8px control and 12px panel radius rule,
  reserved layout geometry for loading states, visible keyboard focus, 44px
  mobile targets, and reduced-motion-safe feedback. The map remains a deferred,
  adapter-backed geographic anchor with an equivalent searchable airport list.
- 2026-07-13 implementation: added the semantic design system, real Better Auth
  registration/verification/sign-in/recovery flows, resumable founding and
  authoritative runway preview/confirmation, four-option founder-aircraft
  comparison and lease acceptance, and the responsive map-led active-airline
  shell. Added narrow current-catalog, current-career, and provider-availability
  contracts plus Mailpit-backed local authentication email delivery.
- Validation: frozen install, format, lint, boundary checks, nine-package
  typecheck, 138 unit tests, production build, OpenAPI/client and Kysely freshness,
  migration currency, 101 database integration tests, 27 API integration tests,
  and 3 worker integration tests passed. A blank-volume Compose rebuild applied
  all 18 migrations, published 250 airports and 4 aircraft variants, and reached
  ready state. Three Playwright journeys passed against that stack, including
  mobile and keyboard onboarding, password reset, session recovery, axe checks,
  and external-map-style fallback. Production visual QA covered 390x844,
  1280x800, and 1600x1000 layouts plus a representative sign-in error state.
