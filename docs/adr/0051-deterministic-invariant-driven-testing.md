# ADR-0051: Require deterministic and invariant-driven testing

Status: accepted

## Context

Persistent jobs may be duplicated, delayed, retried, or recovered through
reconciliation. Time, randomness, finance, fuel, aircraft position, schedules,
and maintenance interact in ways that example-only tests will not cover. A game
can appear functional while slowly corrupting authoritative state.

## Decision

Simulation code receives time and seeded randomness explicitly. Verification
includes:

- Deterministic unit tests.
- Property-based invariant tests.
- Integration tests against real PostgreSQL and Redis containers.
- Browser end-to-end tests for the primary career lifecycle.
- Replay tests for duplicate, stale, delayed, and reconciled jobs.
- Fixed balance scenarios with expected economic ranges.

Core invariants include balanced ledger postings, non-negative constrained
resources, aircraft-position continuity, non-overlapping rotations, and
immutable settled outcomes.

## Consequences

- Ambient clock and unseeded random calls are prohibited inside core simulation
  logic.
- Test fixtures require versioned world rules and reference data.
- CI needs containerized integration services and may have separate fast and
  comprehensive suites.
- Production incidents should become deterministic regression fixtures where
  possible.
