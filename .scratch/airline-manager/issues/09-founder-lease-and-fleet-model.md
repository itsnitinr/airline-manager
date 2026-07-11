# Implement the founder lease and fleet model

Type: task
Status: resolved
Blocked by: 05, 07, 08

## Goal

Let a new airline select one viable subsidized operating lease and create an
individual aircraft with coherent ownership, location, configuration, and
history.

## Scope

- Model individual aircraft, variant, operator, owner/lessor, current airport,
  delivery status, age, hours, cycles, condition, and optimistic version.
- Model operating leases, term, recurring payments, usage/return conditions,
  deposit subsidy, default, and return state.
- Publish a founder package containing all four starter variants with clear
  network, cost, and risk tradeoffs.
- Configure slice-one aircraft with an economy cabin within variant limits.
- Deliver qualifying small founder aircraft immediately and cap all other
  founder deliveries at 24 real hours.
- Respect real production status in the contemporary ruleset.
- Prevent sale or collateralization of the leased founder aircraft.
- Expose fleet list/detail and founder-package comparison queries.

## Out of scope

- The complete dynamic used-aircraft marketplace.
- New factory orders beyond the founder package.
- Cabin reconfiguration UI or premium cabins.

## Acceptance criteria

- Exactly one founder lease can be accepted per career.
- Lease acceptance and initial/deposit ledger postings are atomic and
  idempotent.
- Created aircraft retains the selected variant/catalog version and begins at
  the principal base after delivery.
- Discontinued variants cannot enter through a factory-new channel under the
  contemporary ruleset.
- Return/default rules cannot be used to create cash or duplicate aircraft.

## References

- ADR-0019: Dynamic market with compressed delivery.
- ADR-0024: Subsidized founder aircraft lease.
- ADR-0029: Cabin configuration.
- ADR-0053: Real-time age and utilization-driven wear.

## Comments

Implemented `founder-package-v1` for all four published starter variants with versioned lease,
delivery, cabin, provenance, network, cost, commonality/risk, and runway tradeoffs. Added immutable
individual-aircraft identity/catalog snapshots, lessor-owned operating leases and exact schedules,
economy-only physical cabins, append-only lifecycle history, optimistic transitions, cash-neutral
return/default behavior, and sale/collateral/cash-extraction restrictions.

Acceptance is one serializable idempotent transaction covering the lease, aircraft, ownership,
deposit/subsidy journals, schedule, lifecycle, and outbox. Immediate aircraft deliver at the
principal base; delayed aircraft persist a maximum-24-hour target and due intent. The clock-injected
framework-independent due-delivery handler enforces the target without adding a BullMQ consumer.

Validation passed frozen install, formatting, lint, boundaries, OpenAPI/client freshness,
type-check, unit/property tests, build, generated DB type freshness, blank/repeat PostgreSQL
migrations, repeat catalog seeding, 59 database integration tests, and 13 authenticated API
integration tests. Public-repository diff, provenance, ignored-file, whitespace, and secret reviews
were completed before the focused ticket commit.
