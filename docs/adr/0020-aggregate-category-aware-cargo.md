# ADR-0020: Aggregate cargo by category, weight, and volume

Status: accepted

## Context

Cargo needs different constraints from passenger seats: aircraft can run out of
weight or volume, freight has different urgency and handling needs, and both
belly capacity and dedicated freighters should compete for demand. Individual
package simulation would add state without useful management depth.

## Decision

Cargo demand will be aggregated by origin-destination market, weight, volume,
category, and time sensitivity. Initial categories may include general,
express, perishable, and special cargo. Category rules can require airport
handling capability or restrict aircraft eligibility.

Passenger-aircraft belly capacity and dedicated freighters will serve the same
cargo markets. Individual parcels will not be simulation entities.

## Consequences

- Payload allocation must consider passenger baggage, cargo weight, cargo
  volume, and aircraft limits together.
- Cargo yield and spoilage or lateness effects vary by category.
- Airport capability and airline certification can gate special cargo.
- Demand and booking storage can remain aggregate rather than parcel-level.
