# ADR-0007: Make constrained career the primary mode

Status: accepted

## Context

An unrestricted sandbox supports experimentation but removes much of the
economic tension from fleet, route, fuel, and maintenance decisions. Permanent
account failure, on the other hand, would make realistic airline insolvency too
punitive.

## Decision

The primary game mode is a financially constrained career. A new airline begins
with limited capital and must become viable through its network, fleet,
schedule, pricing, fuel, and maintenance decisions. An airline can become
insolvent.

The player account is distinct from the airline. If an airline fails, the
account retains its identity and history and can found another airline. A
no-failure sandbox is deferred.

## Consequences

- Financial and operational decisions need genuine downside risk.
- Failure and recovery rules must be clear and avoid leaving a career in an
  indefinitely unplayable state.
- Airline state, ownership, and player identity must be separate domain
  concepts.
- Tutorials and forecasts are important because early mistakes can matter.
