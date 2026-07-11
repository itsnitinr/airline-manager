# Accounting model

The ledger stores non-negative integer ISO minor units. Currency metadata is
versioned with the schema and conversion uses exact rational rates followed by
half-even rounding. JavaScript `number` values are never used for money or
rates.

Each journal has one transaction currency and the accounting book's reporting
currency. Its postings must independently sum to zero in both the transaction
and reporting columns before PostgreSQL permits `posted` status. A multi-currency
settlement is represented by linked single-transaction-currency journals through
the FX-clearing account. Any reporting-only rounding residual is an explicit
zero-transaction-minor posting to that account; it is never hidden in another
line.

The applied exchange-rate import, exact numerator and denominator are copied to
the journal. Settlement-date differences are posted explicitly to realized FX
gain/loss. Period-end remeasurement is an adjusting journal to unrealized FX
gain/loss and is reversed or replaced in a later open period. This foundation
does not trade, hedge, fetch live rates, or choose update frequency.

Draft journals are private construction state. Finalization locks the book and
journal, verifies the open period and both balances in PostgreSQL, posts the
journal, completes the idempotency record, and writes an outbox row in one
serializable transaction. Posted journals and lines are append-only. Corrections
are linked reversals or new adjusting entries. Reports are SQL projections over
posted ledger lines; no independent financial total is persisted.

Chart templates and their accounts have explicit versions. The published
`airline-career` version contains structural account mappings but no founder
amounts or final economy balance values. Ticket 08 can instantiate the generic
book for an airline and post founder transactions.
