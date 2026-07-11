# Implement global fuel inventory, capacity, and purchasing

Type: task
Status: resolved
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

## Answer

Implemented the global fuel market, exact inventory and valuation model,
capacity investments, generic consumption boundary, authenticated APIs, and
required deterministic/property/PostgreSQL verification described below.

## Comments

- Implemented one airline-wide integer-kilogram inventory because mass is stable
  across temperature and permits exact `bigint` conservation. Fuel rules,
  deterministic hourly global prices, quote lifetime, reserve default, and the
  finite capacity ladder are offline, versioned, and immutable after activation.
- Chose perpetual weighted-average valuation. Consumption removes a half-even
  proportional cost (or the complete residual value on final consumption),
  while immutable lots retain acquisition/price/FX provenance and append-only
  movements retain every physical and valuation effect. Corrections and
  reversals are explicit movements and adjusting/reversing ledger journals.
- Purchases, externally calculated consumption, reserve changes, corrections,
  reversals, and capacity upgrades lock the global inventory in serializable
  transactions and commit idempotency, ledger, movements/lots/history, and
  outbox state atomically. Forecasts and reserves remain advisory partitions and
  never make authoritative on-hand fuel negative.
- Validation passed: frozen install; formatting, lint, boundary, type, unit and
  250-run property tests; production build; OpenAPI/generated-client freshness;
  blank and repeat migrations, fixture seed, migration and generated Kysely type
  freshness; 66 real-PostgreSQL database integration tests and 15 authenticated
  API integration tests, including concurrent cash/capacity contention,
  ownership substitution denial, exact ledger reconciliation, all movement
  classes, quote expiry, reserve/forecast behavior, and sensitive-error checks.
