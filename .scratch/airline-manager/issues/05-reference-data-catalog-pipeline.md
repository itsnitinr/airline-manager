# Build the curated reference-data catalog pipeline

Type: task
Status: resolved
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

- 2026-07-11: Added the PostgreSQL/Kysely reference catalog pipeline with source registry,
  checksum/versioned idempotent raw imports, quarantined validation results, explicit curated
  promotion, IANA 2026b timezone definitions, field-level sourced/derived/balance provenance,
  immutable published releases, immutable active world rulesets, data-driven production/acquisition
  rules, and read-only domain/application/database query boundaries. Published a deterministic
  redistributable slice-one fixture of 250 validated commercial airports across AF 25, AS 60, EU 60,
  NA 60, OC 20, and SA 25, plus ATR 72-600, Embraer E175, Airbus A320neo, and Boeing 737-8 variants
  backed by OurAirports public-domain data, IANA/Timezone Boundary Builder data, manufacturer pages,
  and FAA TCDS references. Validation passed for frozen install, formatting, lint, eight boundary
  probes, OpenAPI freshness, type-check, 39 offline unit tests, build, blank and repeat migrations,
  generated Kysely type freshness, 16 real-PostgreSQL integration tests covering idempotency,
  quarantine/constraints, release and ruleset immutability/selection, acquisition overrides and
  read-only queries, byte-for-byte offline fixture regeneration, Compose configuration, ignored-file
  checks, attribution/license review, diff/whitespace review, and public-repository secret scanning.
