# Qualified workforce capacity

Ticket 13 represents staff only as aggregate workforce pools keyed by airline, principal operating
base, role, and qualification. Pilots use a type rating derived from the career's immutable published
aircraft-variant catalog; cabin crew, line maintenance, and ground handling use explicit slice-one
general qualifications. There are no employee identities, résumés, individual contracts, or manual
rosters.

`workforce-v1` publishes balance-classified hiring, training, wage, fatigue, demand, and founder-package
rules for all four starter variants. Hiring posts separate balanced hiring and training journals at the
command's effective time. Capacity remains unavailable until its persisted training completion time.
Due training is caught up deterministically under a pool lock, while a checkpoint intent and outbox
event preserve the future ticket 16 delivery boundary.

Recurring wages accrue from persisted pool checkpoints in exact reporting-currency minor units. Each
accrual retains its capacity, interval, amount, and journal reference, making workforce state directly
reconcilable to the ledger. Repeating an accrual cannot post the same interval twice.

## Timetable demand and readiness

Slice-one flight demand uses two type-rated pilots, cabin capacity based on economy seats, and one
line-maintenance unit. Ground-handling demand is omitted because ticket 12 only creates these dated
flights after validating eligible outsourced service. Forecasts sweep active dated flights in stable departure/id order and
explain shortages with role, qualification, base, duty/recovery window, required capacity, available
capacity, shortfall, and a corrective action.

The readiness command is the stable ticket 17 integration boundary. It locks the dated flight and
each matching pool, rechecks overlapping duty plus fatigue-recovery reservations, and writes all role
allocations atomically. Concurrent flights therefore cannot consume the same aggregate capacity. A
shortage writes no allocations and does not advance flight status; ticket 17 remains responsible for
the operational lifecycle and suspension consequences.
