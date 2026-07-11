# ADR-0029: Configure cabins by class and density

Status: accepted

## Context

Fixed aircraft capacity would remove an important distinction between low-cost,
full-service, and premium strategies. An individual seat-map and monument editor
would imply detailed certification and interior-engineering rules beyond the
initial simulation's useful depth.

## Decision

Players configure an aircraft's capacity and density across supported economy,
premium-economy, business, and first cabins. Aircraft-variant data defines
plausible limits and supported arrangements.

Configuration affects capacity, weight, comfort, demand, fare potential,
service cost, and turnaround. Reconfiguration incurs a financial cost and
grounds the aircraft for a defined duration. Individual seats, galleys, and
lavatories are not placed manually.

## Consequences

- Cabin configuration is distinct from revenue-management booking classes.
- Payload calculations must combine cabin, passengers, baggage, and cargo.
- Demand needs class-specific willingness to pay and comfort response.
- Configuration changes require effective timing and cannot rewrite flights
  already sold under an incompatible cabin.
