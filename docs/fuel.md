# Global fuel model

Fuel is airline-wide and fungible. Its canonical physical unit is the integer
kilogram: mass is conserved independently of temperature, unlike volume, and a
`bigint` quantity never crosses JavaScript floating point. Airport stock,
delivery, tankering, suppliers, and burn formulas are intentionally absent.

The active fuel ruleset versions the world seed, price formula, hourly bucket,
quote lifetime, reserve default, and finite capacity tiers. The FNV-1a 64-bit price
formula maps `(world seed, ruleset version, formula version, currency, bucket)`
to an exact bounded basis-point displacement from a fixture price per tonne.
Prices and FX snapshots are rational integers; purchase totals use half-even
rounding once at the transaction-minor-unit boundary.

Inventory uses perpetual weighted-average valuation. A consumption removes
`round-half-even(current value * kilograms consumed / kilograms on hand)`,
except that consuming the final kilogram removes the full remaining value.
This makes every rounding residual explicit in the remaining inventory and
guarantees that physical inventory and ledger account 1200 reconcile. Purchase
lots remain immutable provenance records; remaining quantity/cost are derived
from the append-only movement stream rather than silently rewriting a lot.
Corrections and reversals are new movements and adjusting/reversing journals.

Commands lock the owned airline inventory and ledger book inside a serializable
transaction, validate cash and capacity from posted ledger rows, persist an
idempotency response, post the journal, and append outbox events before commit.
Planning reserve and projected burn are advisory partitions of on-hand stock;
they cannot make authoritative inventory negative. Actual consumption is the
only operation that reduces on-hand fuel.
