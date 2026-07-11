# ADR-0010: Schedule recurring timetables with aircraft rotations

Status: accepted

## Context

Manual dispatch creates frequent interaction but turns airline operation into a
repetitive click cycle and weakens realistic fleet planning. A timetable-based
model makes route frequency, utilization, connections, maintenance, and ground
time meaningful.

## Decision

Players will create recurring weekly timetables made of flight legs and assign
specific aircraft through rotations. Rotations include required turnaround,
positioning, and maintenance windows. The backend validates feasibility before
a schedule becomes active.

Templates and assisted scheduling may construct or suggest valid rotations for
beginners, but they use the same rules as manual planning.

## Consequences

- Route, flight leg, timetable, and aircraft rotation are separate domain
  concepts.
- Validation must account for overlap, aircraft location, performance, airport
  restrictions, turnaround, and maintenance.
- Schedule changes need effective dates so already-booked or in-progress
  flights are not rewritten retroactively.
- The UI needs a legible weekly planning surface and actionable conflict
  explanations.
