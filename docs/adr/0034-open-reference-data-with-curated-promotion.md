# ADR-0034: Curate playable reference data from redistributable sources

Status: accepted

## Context

Global airport and aircraft data varies in coverage, accuracy, update cadence,
and licensing. Raw open datasets can provide broad coverage but do not guarantee
fitness for a commercial-airline simulation. Proprietary databases may be
accurate but introduce licensing cost and redistribution restrictions.

## Decision

The initial catalog will use sources that permit the required use and
redistribution, combined with validation and manual curation. Candidate sources
include:

- OurAirports public-domain airport data: https://ourairports.com/data/
- IANA timezone data: https://www.iana.org/time-zones
- Manufacturer publications.
- Regulator certification documents such as FAA Type Certificate Data Sheets.

Every import retains source identity, version, retrieval time, attribution, and
validation status. A raw imported record becomes playable only through an
explicit curated promotion. Proprietary aviation databases will not be scraped
or required initially.

## Consequences

- Import, validation, curation, and gameplay publication are separate stages.
- Data-source licenses and attribution obligations require a maintained
  registry.
- Curators need tooling to compare changes and approve or quarantine records.
- A later licensed source can be added behind the same provenance and promotion
  pipeline.
