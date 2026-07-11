# ADR-0003: Use one simulation with progressive disclosure

Status: accepted

## Context

The game prioritizes realism and an aviation-enthusiast audience, but requiring
specialist knowledge at onboarding would make the initial experience
unnecessarily inaccessible. Maintaining separate casual and expert simulation
modes would duplicate rules and make outcomes difficult to explain.

## Decision

The game will use one underlying simulation. New players receive explanations,
forecasts, recommendations, and sensible defaults. Advanced controls reveal
more direct management of the same underlying systems rather than switching to
a different ruleset.

## Consequences

- Beginner defaults must be viable but need not be perfectly optimized.
- Outcomes shown in simplified views must remain traceable to the detailed
  simulation.
- Advanced management can be introduced gradually as the airline grows.
- Features should avoid parallel basic and expert implementations of the same
  rule.
