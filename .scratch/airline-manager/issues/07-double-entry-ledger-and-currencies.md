# Implement the double-entry ledger and multi-currency foundation

Type: task
Status: open
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

None yet.
