# ADR-0006: Model a curated modern fleet at variant level

Status: accepted

## Context

Aircraft within one family can have materially different engines, capacity,
range, runway requirements, fuel burn, acquisition costs, and maintenance
economics. A broad catalog of every aircraft category would sacrifice depth and
data quality in the initial release.

## Decision

The initial catalog will model specific variants of common modern commercial
passenger jets and turboprops. Factory-built freighter variants may be included
where reliable operational data is available.

Historic classics, prototypes, military aircraft, helicopters, private jets,
and other specialty categories are excluded from the initial scope.

## Consequences

- Fleet choices can reflect meaningful operational differences between nearby
  variants.
- Reference data, balance values, and provenance are maintained per variant.
- Passenger and freighter variants are distinct types rather than configuration
  toggles when their real-world characteristics differ.
- Additional eras and aviation categories can be introduced later as coherent
  expansions instead of incomplete launch content.
