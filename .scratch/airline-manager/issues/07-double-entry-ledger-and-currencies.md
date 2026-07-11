# Implement the double-entry ledger and multi-currency foundation

Type: task
Status: resolved
Blocked by: 03, 04

## Goal

Make every financial balance and report derive from immutable balanced postings
with exact currency handling.

## Scope

- Define chart-of-accounts templates, journal entries, postings, dimensions,
  accounting periods, and adjusting/reversing entries.
- Represent money exactly with explicit ISO currency codes and rounding policy.
- Preserve transaction currency, reporting currency, and applied exchange-rate
  snapshots.
- Add a versioned exchange-rate import/update interface with deterministic test
  fixtures.
- Implement idempotent posting APIs for cash, equity, loans, leases, fuel,
  revenue, wages, maintenance, airport costs, refunds, and adjustments.
- Produce cash, profit-and-loss, balance-sheet, and cash-flow read models.
- Support attribution dimensions for airline, aircraft, route, flight, station,
  and contract without making every dimension mandatory.

## Out of scope

- FX trading or hedging.
- Final balance values for gameplay systems.
- Silent edits to posted journals.

## Acceptance criteria

- The database prevents an unbalanced journal from becoming posted.
- Repeating a posting command with the same idempotency key does not duplicate
  money movement.
- Reports reconcile to ledger balances in original and reporting currencies.
- Corrections use explicit reversals or adjustments and retain history.
- Property tests cover zero-sum postings, rounding, and exchange conversion.

## References

- ADR-0027: Double-entry airline ledger.
- ADR-0028: Multi-currency transactions and one reporting currency.
- ADR-0038: Immutable history and transactional state.

## Comments

- 2026-07-11: Added a versioned airline-career chart template (structure only), generic
  accounting books and periods, exact integer-minor-unit currencies, rational half-even FX
  conversion with immutable versioned offline imports, balanced immutable journals/postings,
  explicit adjustments and linked reversals, optional airline/aircraft/route/flight/station/contract
  dimensions, idempotent named posting services, transactional outbox records, and ledger-derived
  cash, P&L, balance-sheet, and cash-flow reports. The auditable rule is one transaction currency
  per journal, independently balanced transaction and reporting columns; multi-currency settlement
  uses linked journals through FX clearing, reporting rounding is an explicit reporting-only clearing
  line, settlement differences use realized FX accounts, and period-end remeasurement uses reversible
  unrealized-FX adjustments. Validation passed for frozen install, formatting, lint/boundaries,
  contract freshness, type-check, unit/property tests, build, blank/repeat PostgreSQL migrations,
  generated types, 25 real-PostgreSQL ledger/foundation/catalog integration tests, 7 API integration
  tests, concurrent idempotency, direct unbalanced-finalization and posted-history mutation attempts,
  deterministic offline rates, report reconciliation, production images, healthy Compose topology,
  safe logs/errors, ignored files, whitespace, and public-repository secret scanning.
