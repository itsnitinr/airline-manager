# ADR-0014: Combine player fare strategy with assisted revenue management

Status: accepted

## Context

Manually pricing every future departure would become repetitive as an airline
grows. Fully automatic pricing would remove a central commercial decision and
make results feel detached from player strategy.

## Decision

The game will manage cabin inventory through booking classes. Beginners may
select a pricing posture or accept a recommendation. Advanced players may set
cabin-level base fares, minimums, maximums, and load-factor or revenue targets.

The revenue-management system adjusts booking-class availability using demand,
remaining seats, booking pace, seasonality, schedule quality, and competition,
while remaining within the player's chosen strategy and guardrails.

## Consequences

- Booking class is distinct from physical cabin and seat configuration.
- Pricing decisions can scale from one route to a large network.
- Flight settlement must preserve the realized fare mix, not only an average
  ticket price.
- Recommendations need forecasts and explanations so automation is auditable.
