# Implement slice-one qualified workforce capacity

Type: task
Status: open
Blocked by: 07, 08, 09, 12

## Goal

Make staffing a real operating constraint without introducing named employees or
manual rosters.

## Scope

- Model workforce pools by airline, base, role, and qualification.
- Support pilot type rating, cabin crew, line-maintenance, and ground-handling
  capacity needed by slice-one flights.
- Implement hiring, training lead time, wages, availability, and simple fatigue
  recovery using aggregated capacity.
- Provide founder recommendations and minimum viable staffing packages for each
  starter variant.
- Validate schedule staffing demand against qualified capacity and outsourced
  ground handling.
- Post hiring/training and recurring wage costs through the ledger.
- Forecast staffing shortages across the active timetable.

## Out of scope

- Named employees, personalities, résumés, or shift-by-shift rosters.
- Deep commercial departments or multi-base transfers.

## Acceptance criteria

- Flights cannot be dispatched without the required qualified capacity.
- A pilot pool cannot cover incompatible type ratings.
- Concurrent flights consume capacity without double allocation.
- Hiring and training become available only after their defined lead times.
- Wage and training postings reconcile to workforce state and ledger reports.

## References

- ADR-0018: Qualified workforce pools.
- ADR-0008: Capability-based progression.
- ADR-0031: Safe suspension on hard shortages.

## Comments

None yet.
