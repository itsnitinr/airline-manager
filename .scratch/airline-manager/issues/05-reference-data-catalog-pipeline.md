# Build the curated reference-data catalog pipeline

Type: task
Status: open
Blocked by: 03

## Goal

Import open real-world data into quarantined staging, validate it, and publish a
versioned slice-one catalog of approximately 250 airports and four aircraft
variants.

## Scope

- Create source-registry, raw-import, validation-result, curated-record,
  provenance, catalog-release, and world-ruleset schemas.
- Import OurAirports and IANA timezone data without treating raw rows as
  playable.
- Add manual/source-backed aircraft-variant curation from manufacturer and
  regulator publications.
- Classify each value as sourced, derived, or balance data and retain effective
  dates and ruleset/formula versions.
- Validate airport coordinates, timezone, codes, runway data, commercial
  eligibility, and source completeness.
- Curate a globally distributed set of roughly 250 commercial airports.
- Curate one turboprop, one regional jet, and two familiar narrow-body variants.
- Support data-driven production status and acquisition-channel overrides by
  world ruleset.
- Expose read-only catalog queries for later API and admin consumers.

## Out of scope

- Automated publication without review.
- Proprietary data scraping.
- Cargo and freighter content in slice one.

## Acceptance criteria

- Re-running the same source import is idempotent and records source version and
  retrieval time.
- Invalid or incomplete records remain quarantined with actionable reasons.
- A catalog release is immutable after publication and can be selected by a
  world ruleset.
- The slice-one airport and aircraft counts and regional distribution are
  asserted by tests.
- Every playable field can be traced to sourced, derived, or balance provenance.

## References

- ADR-0005: Global curated airport catalog.
- ADR-0006: Variant-level modern aircraft catalog.
- ADR-0033: Provenance classes.
- ADR-0034: Open data with curated promotion.
- ADR-0043: Slice-one catalog size.

## Comments

None yet.
