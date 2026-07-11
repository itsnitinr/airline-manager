# ADR-0043: Bound the first playable reference catalog

Status: accepted

## Context

The final product requires a global curated catalog, but validating thousands of
airports and many aircraft variants before proving one complete career would
delay feedback. Too little data would make route and fleet choices unconvincing.

## Decision

The first playable slice targets approximately 250 high-confidence commercial
airports distributed globally. It targets four starter aircraft variants: one
turboprop, one regional jet, and two familiar narrow-bodies.

The set must support viable short-, medium-, and longer-range starting
strategies. It is published through the same import, validation, curation, and
promotion pipeline used for later catalog expansion.

## Consequences

- Manual verification is bounded while the initial network still feels global.
- The exact airport list and four variants become a curated data deliverable.
- Demand and balance fixtures can be tested exhaustively across the smaller
  catalog.
- Catalog expansion is a data release and does not require application-code
  branching.
