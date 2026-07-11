# ADR-0008: Gate progression by airline capability

Status: accepted

## Context

Traditional levels and experience points provide clear progression but would
make access to real aircraft and locations depend on an artificial meta-system.
The simulation already contains financial, physical, operational, safety, and
regulatory constraints that can create meaningful progression.

## Decision

Aircraft, airports, and route opportunities will not be hidden behind arbitrary
player levels. An airline's ability to undertake an operation is determined by
its actual capability, including capital, creditworthiness, compatible assets,
staffing, maintenance support, safety record, reputation, and regulatory
standing.

## Consequences

- The catalog can show aspirational options together with the concrete reasons
  they are not yet viable.
- Capability requirements and their causes must be explainable in the UI.
- Reputation, safety, certification, and creditworthiness require explicit
  domain models rather than being collapsed into one experience score.
- Progression balance comes from interacting simulation constraints rather than
  content unlock tables.
