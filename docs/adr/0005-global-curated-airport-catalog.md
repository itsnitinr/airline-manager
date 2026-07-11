# ADR-0005: Use a global curated airport catalog

Status: accepted

## Context

A region-limited launch would simplify data preparation but constrain the core
fantasy of building an airline network. Importing every real-world airport and
airstrip would create poor choices, incomplete operational rules, and a false
impression of equal commercial suitability.

## Decision

The initial playable airport catalog will be global. Airports become playable
only when they satisfy explicit criteria for scheduled commercial relevance and
have enough trustworthy data to support the simulation, including coordinates,
timezone, runway information, and other required operational constraints.

## Consequences

- Players can build international and intercontinental networks from launch.
- Airport ingestion needs validation, provenance, eligibility rules, and a way
  to quarantine incomplete records.
- The playable catalog will be smaller than the raw source dataset.
- Catalog expansion can occur through data-quality improvements without
  changing the core game rules.
