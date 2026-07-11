# ADR-0022: Model congestion without player-managed airport slots

Status: accepted

## Context

Real slot coordination can involve paired rights, historic precedence,
utilization requirements, transfers, seasons, and filings. Making players
manage those rights would add substantial timetable administration and distract
from the desired airline-management depth.

Ignoring airport capacity entirely would allow implausible schedules and remove
the commercial difference between peak and quiet periods.

## Decision

The initial game will not model airport slots as assets the player acquires,
leases, or maintains. Congested airports will instead apply time-dependent fees,
minimum-turnaround or delay effects, and backend-enforced schedule-capacity
ceilings. The player receives clear validation and forecasts.

## Consequences

- Peak-time airport access remains costly and operationally constrained.
- Timetable planning does not require a separate slot-management workflow.
- Capacity rules can be data-driven and later replaced or extended by a deeper
  coordinated-slot system.
- The UI must distinguish a hard capacity rejection from a probabilistic
  congestion delay.
