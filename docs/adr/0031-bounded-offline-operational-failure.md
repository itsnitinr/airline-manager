# ADR-0031: Bound offline failure through automatic suspension

Status: accepted

## Context

Persistent offline progression means fuel, cash, staffing, or maintenance can
become insufficient while the player is away. Continuing to dispatch invalid
flights or accumulate unbounded obligations would be unsafe, unfair, and likely
to leave careers unrecoverable. Removing all consequences would make forecasts
and reserves meaningless.

## Decision

The game will forecast material resource shortages and allow configurable cash
and fuel reserves. When a hard requirement cannot be met, affected future
flights automatically enter operational suspension rather than departing or
continuing to compound obligations.

Suspension still produces defined consequences such as refunds, direct costs,
and reputation loss. Those consequences stop or become bounded once affected
operations are suspended.

## Consequences

- Schedule activation and ongoing monitoring both need feasibility forecasts.
- Suspension reasons and recovery actions must be explicit.
- Flight-state transitions must distinguish cancellation, suspension, delay,
  and completed operation.
- Notifications are important, but absence of notification delivery cannot
  change the safe backend behavior.
