# ADR-0017: Model serious safety consequences without fatal accidents

Status: accepted

## Context

Safety must matter for a realistic airline operation. Random fatal accidents
would be extremely rare, difficult to represent proportionately, potentially
exploitative, and disproportionately punitive as a game mechanic.

## Decision

The game will not simulate crashes or passenger fatalities. Unsafe maintenance
and operational decisions can instead produce delays, diversions,
cancellations, emergency repairs, aircraft groundings, regulatory scrutiny,
fines, higher insurance costs, reputation loss, and certificate suspension.

## Consequences

- Safety management remains financially and operationally consequential.
- Incident generation needs bounded, explainable causes and outcomes.
- No random event can destroy an aircraft or kill simulated passengers.
- Safety standing, regulatory action, insurance, reputation, and reliability
  remain connected but distinct domain concepts.
