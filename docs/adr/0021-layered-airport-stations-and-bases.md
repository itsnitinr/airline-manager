# ADR-0021: Separate airport service from station investment

Status: accepted

## Context

Requiring owned facilities before serving an airport would make network
expansion slow and unrealistic. Treating every airport as identical pay-per-use
access would remove the strategic value of bases, dedicated capacity, local
staff, maintenance, lounges, and cargo infrastructure.

## Decision

An airline selects one principal base at founding and may establish additional
operating bases later. It can begin serving an eligible airport through
outsourced handling and pay-per-use access. It may then invest in a station's
gates, lounges, maintenance, crew, and cargo-handling capability.

Airports may have finite capacity, curfews, and congestion pressure. Players do
not construct or own complete airport terminals in the initial game. Per
ADR-0022, they also do not manage slot rights initially.

## Consequences

- Airport service, station presence, and operating-base status are distinct.
- Network experimentation remains possible before large fixed investment.
- Local investment can reduce cost and improve capacity, reliability, service,
  connection quality, or workforce availability.
- Closing a station needs rules for leases, staff, based aircraft, and active
  schedules.
