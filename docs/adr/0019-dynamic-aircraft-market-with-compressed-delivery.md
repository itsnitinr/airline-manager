# ADR-0019: Use a dynamic aircraft market with compressed delivery

Status: accepted

## Context

Instant unlimited acquisition would remove fleet-planning and market tradeoffs.
Real manufacturing and delivery lead times can span months or years, which is
incompatible with an engaging persistent game where flight durations run in
real time.

## Decision

Aircraft can be acquired through new orders, operating leases, used purchases,
and secured financing. Availability is limited and dynamic. Used aircraft
retain age, condition, accumulated hours and cycles, and maintenance status.
In the contemporary default ruleset, discontinued aircraft are not eligible for
factory-new orders and can only enter through used or lease channels.
Alternative world rulesets may explicitly override acquisition eligibility
without modifying the underlying production-status reference data.

Delivery delay is deliberately compressed. Small aircraft may be delivered
immediately. Other deliveries scale with aircraft and acquisition conditions,
but no aircraft delivery takes longer than 24 real hours.

## Consequences

- Fleet expansion retains anticipation and planning without multi-day forced
  inactivity.
- Delivery duration is a gameplay value, not a literal manufacturing timeline.
- New, leased, and used channels need distinct commercial terms and inventory.
- Players need a delivery queue and clear countdowns.
- Aircraft eligibility for new purchase still follows real-world production
  status; time compression does not make discontinued variants factory-new.
- Production status and acquisition-channel eligibility must be versioned data,
  not aircraft-specific application logic, so a later ruleset can change them.
- Existing careers retain their selected ruleset version when new scenarios or
  rule changes are introduced.
