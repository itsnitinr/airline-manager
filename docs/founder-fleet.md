# Founder lease and fleet model

Ticket 09 publishes `founder-package-v1` for the contemporary slice-one world ruleset. The
package contains one operating-lease option for each of the four aircraft variants in the
published catalog. Aircraft range, capacity, runway envelope, and production status remain
catalog facts with their existing provenance. Lease prices, deposits, subsidies, economy cabin
choices, strategic terms, and compressed delivery delays are explicitly versioned balance data;
they are not represented as manufacturer facts.

Acceptance is a serializable, idempotent transaction. It creates the lease and immutable first
term, exact payment schedule, individual lessor-owned aircraft, economy-only physical cabin,
player ownership scope, deposit and subsidy journals, lifecycle history, and transactional outbox
events together. A unique career constraint is the final concurrent exactly-once guard. The
fully subsidized founder deposit has a zero refundable amount, so return or default cannot produce
cash. The aircraft is never airline-owned and its identity trigger freezes the accepted catalog
release, variant snapshot, lessor, lease, serial, and manufacturing facts.

Immediate options become delivered at the principal base inside acceptance. Delayed options retain
an authoritative target and an `aircraft.delivery_due.v1` outbox intent whose availability equals
that target. `DueAircraftDeliveryHandler` is framework-independent and clock-injected; it refuses
early or stale transitions and can later be called by ticket 16. No BullMQ consumer or background
scheduler is part of ticket 09.

Lifecycle rows and posted journals are append-only. Return and default terminal transitions remove
the airline as operator, retain the lessor and aircraft history, cancel unpaid schedule rows, emit
an outbox event, and make no cash posting. Slice one stores one physical economy cabin and explicitly
does not create future revenue-management booking classes or cabin-reconfiguration behavior.
