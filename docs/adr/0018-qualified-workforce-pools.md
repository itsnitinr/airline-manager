# ADR-0018: Represent staff as qualified workforce pools

Status: accepted

## Context

Staff availability, qualification, fatigue, training, and wages are important
airline constraints. Simulating and rostering every employee would create a
large scheduling problem and substantial state without proportionate strategic
value for the initial game.

## Decision

Staff will be represented as workforce pools defined by role, base, and
qualification. Pools cover pilots, cabin crew, maintenance personnel, ground
operations, and commercial functions as appropriate. Operations consume
qualified capacity, and hiring, training, wages, fatigue limits, and shortages
affect availability.

Individual employee identities, personalities, résumés, and shift-by-shift
manual rostering are excluded from the initial model.

## Consequences

- A flight can validate crew capability without assigning named people.
- Pilot type ratings and maintenance qualifications create meaningful fleet
  commonality effects.
- Workforce demand can scale to large airlines without millions of roster
  assignments.
- Fatigue and availability formulas need explainable aggregation rules.
