# ADR-0012: Support direct and one-stop passenger itineraries

Status: accepted

## Context

Direct-only demand would make hub structure and regional feed largely cosmetic.
Searching arbitrary multi-stop paths would add substantial combinatorial cost,
booking complexity, and edge cases before the core network simulation is
validated.

## Decision

Passenger booking allocation will consider both direct itineraries and valid
one-stop itineraries. Itinerary choice accounts for total fare, elapsed journey
time, connection risk, service, airline reputation, and schedule convenience.

Journeys requiring more than one connection are excluded from the initial
model.

## Consequences

- A route is not the same as the passenger's complete journey.
- Timetable coordination and minimum connection times affect network demand.
- Missed-connection handling and protected itineraries need explicit rules.
- Itinerary search can use a bounded two-leg candidate space.
