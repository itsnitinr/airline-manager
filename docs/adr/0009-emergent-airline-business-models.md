# ADR-0009: Let airline business models emerge

Status: accepted

## Context

Fixed archetypes make onboarding simple but prevent realistic hybrid strategies
and make later strategic changes feel artificial. The simulation already needs
to represent the decisions that distinguish low-cost, full-service, regional,
and cargo operations.

## Decision

An airline will not select a permanent business-model class. Its observed model
will emerge from independently changeable decisions about network structure,
airports, fleet, cabin configuration, service level, fares, baggage policy, and
cargo allocation.

The UI may summarize the airline's current strategy, but that description does
not impose separate rules or irreversible restrictions.

## Consequences

- Hybrid and evolving strategies are supported naturally.
- Each strategic lever needs its own costs and demand effects.
- Recommendations must account for the airline's current operation instead of
  assuming a selected archetype.
- Strategy labels are derived descriptions, not authoritative domain state.
