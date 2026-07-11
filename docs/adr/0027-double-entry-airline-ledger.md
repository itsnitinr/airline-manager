# ADR-0027: Derive airline finances from a double-entry ledger

Status: accepted

## Context

The game includes inventory, owned and leased aircraft, loans, depreciation,
accrued revenue and costs, and insolvency. Maintaining independent mutable
totals for cash and profit would invite drift and make financial results hard to
audit or explain.

Full accounting detail presented at all times would be intimidating to players
who only need to understand runway and operating performance.

## Decision

All financial transactions post balanced entries to an immutable double-entry
ledger. Cash, profit and loss, balance sheet, cash flow, assets, liabilities,
and route or flight profitability are derived from ledger data.

The default interface presents simplified cash, obligation, and profitability
views. Advanced reports expose statements and underlying journal entries.

## Consequences

- Every economic event needs an idempotent posting rule and stable account
  mapping.
- Corrections use reversing or adjusting entries rather than mutating history.
- Operational entities need traceable dimensions so costs and revenue can be
  attributed to aircraft, routes, flights, stations, and contracts.
- Read models or cached summaries will be needed for responsive dashboards, but
  the ledger remains authoritative.
