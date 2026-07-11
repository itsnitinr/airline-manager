# ADR-0028: Preserve transaction currency and report in one airline currency

Status: accepted

## Context

A global airline incurs charges and contracts in multiple currencies. Treating
all values as one universal currency would hide meaningful exchange effects,
while requiring players to manage FX trading and hedging would add a separate
financial game.

## Decision

Each airline selects a reporting currency at founding. Ledger postings preserve
the transaction's original currency, amount, and applied exchange rate. Reports
translate values into the airline's reporting currency using defined accounting
rules.

Exchange rates update periodically. Active currency trading and FX hedging are
excluded from the initial game.

## Consequences

- Money values must use exact decimal or integer minor-unit representations and
  explicit ISO currency codes.
- Exchange-rate sources, timestamps, and rounding policy require provenance.
- Realized and unrealized currency effects need defined ledger treatment.
- Changing an airline's reporting currency, if ever supported, is a controlled
  accounting migration rather than a display preference.
