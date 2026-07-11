# ADR-0033: Classify realism data by provenance

Status: accepted

## Context

Public sources provide many aircraft and airport facts, but exact fuel burn,
maintenance cost, lease pricing, reliability, and demand behavior vary by
operator and configuration or are commercially sensitive. Treating every game
value as an exact real-world fact would be misleading and difficult to maintain.

## Decision

Simulation inputs are classified as:

- Sourced facts with source provenance and effective dates.
- Derived simulation values calculated or calibrated from public evidence.
- Balance values deliberately designed for viable gameplay.

Derived and balance values are versioned with their formulas or world ruleset.
Player-facing descriptions must not label them as certified manufacturer or
regulator figures.

## Consequences

- Reference-data records need field-level or dataset-level provenance metadata.
- Simulation output can explain which inputs are factual versus modeled.
- Updates can distinguish factual corrections from balance changes.
- Existing careers need stable ruleset references so a balance update does not
  retroactively change already-settled outcomes.
