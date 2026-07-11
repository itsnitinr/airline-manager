# ADR-0013: Represent single-player competition in aggregate

Status: accepted

## Context

A market with no competition would make pricing and network choices implausible.
Operating many full-fidelity AI airlines through the same fleet, schedule,
maintenance, and finance systems would add another major game before the
player's airline simulation is proven.

## Decision

The single-player release will represent competition as aggregate market
conditions: competing capacity, fare pressure, service quality, and resulting
market-share effects. It will not operate complete hidden AI airlines with
individual fleets and timetables.

The market interface must later accept supply from real player airlines in a
shared multiplayer world.

## Consequences

- Commercial choices face credible competitive pressure without full AI
  operations.
- Competitor behavior must change plausibly and remain explainable rather than
  acting as an arbitrary difficulty modifier.
- The UI must not imply that aggregate competitors are fully simulated
  companies.
- Future multiplayer can replace or supplement aggregate supply market by
  market.
