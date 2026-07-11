# ADR-0016: Model utilization-based maintenance without parts logistics

Status: accepted

## Context

Maintenance must affect fleet economics, reliability, and scheduling to support
the realism goal. Simulating every component, spare part, and engineering task
would create a specialized maintenance-management game and require reference
data that is difficult to obtain consistently.

## Decision

Each aircraft follows a maintenance program driven by flight hours, flight
cycles, calendar limits, and aircraft-variant rules. The program includes
routine line work and larger planned maintenance packages. Maintenance consumes
capacity and grounds the aircraft for its duration.

Aircraft condition and dispatch reliability worsen when eligible work is
deferred. Unscheduled faults can cause delays or groundings and require repair.
The initial model excludes individual spare-part inventories and detailed
component engineering.

## Consequences

- Timetables must reserve realistic maintenance windows.
- Flight completion updates aircraft hours and cycles atomically.
- Maintenance due forecasts, condition, deferral consequences, and downtime
  must be explainable.
- Generic check names must not imply identical real programs across every
  aircraft; data can define variant-appropriate packages.
- Parts and component depth can be added later behind the maintenance program
  boundary.
