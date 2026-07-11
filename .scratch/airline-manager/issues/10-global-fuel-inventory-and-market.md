# Implement global fuel inventory, capacity, and purchasing

Type: task
Status: open
Blocked by: 07, 08

## Goal

Provide a simple but economically meaningful airline-wide fuel market and
inventory that later flight settlement can consume safely.

## Scope

- Model airline fuel inventory, finite storage capacity, purchase lots,
  valuation, and immutable movement records.
- Generate a deterministic versioned global fuel price series for the active
  world ruleset.
- Implement purchase commands with quote expiry, capacity validation,
  idempotency, and ledger posting.
- Implement capacity-upgrade offers, purchase, and resulting asset/cost posting.
- Provide inventory balance, weighted valuation, recent prices, forecast burn,
  and projected-shortage queries.
- Reserve configured minimum inventory from optional planning decisions without
  permitting authoritative negative inventory.

## Out of scope

- Airport-local stock, tankering, delivery logistics, or fuel hedging.
- Final flight fuel-burn calculation, implemented in ticket 17.

## Acceptance criteria

- Concurrent purchases cannot exceed cash or storage capacity.
- Every purchase and consumption movement reconciles to the ledger and inventory
  balance.
- Price generation is reproducible for a seed and ruleset version.
- Inventory cannot become negative under concurrent or retried commands.
- Forecasts distinguish on-hand, reserved, and projected consumption.

## References

- ADR-0015: Global airline fuel inventory.
- ADR-0031: Bounded offline failure and reserves.
- ADR-0027: Ledger-backed inventory value.

## Comments

None yet.
