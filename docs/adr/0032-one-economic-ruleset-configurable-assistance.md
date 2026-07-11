# ADR-0032: Launch one economic ruleset with configurable assistance

Status: accepted

## Context

Multiple difficulty modes would require balancing several versions of demand,
cost, reliability, finance, and failure behavior before the core simulation is
proven. Players still need different levels of guidance and management burden.

## Decision

The initial release will have one authoritative economic career ruleset.
Assistance settings may change recommendations, warnings, templates, and
automation, but they do not change demand, costs, reliability, financing, or
other simulation outcomes.

Alternative economic scenarios or difficulty modifiers are deferred.

## Consequences

- Outcomes are comparable and easier to explain, test, and balance.
- Automation must operate through the same commands and constraints available
  to manual play.
- Assistance level is a preference, not part of authoritative simulation state
  unless an automated action is scheduled.
- Future scenarios need explicit versioned world rules rather than hidden
  difficulty multipliers.
