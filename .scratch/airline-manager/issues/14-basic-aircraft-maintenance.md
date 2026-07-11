# Implement slice-one aircraft maintenance and condition

Type: task
Status: open
Blocked by: 07, 09, 12, 13

## Goal

Track utilization-driven maintenance, planned downtime, condition, and bounded
non-fatal faults for the starter fleet.

## Scope

- Model variant-specific maintenance programs, due counters, packages, line
  work, maintenance windows, and completed work.
- Accumulate flight hours, cycles, and balanced real-day calendar thresholds.
- Track aircraft condition and dispatch reliability without component inventory.
- Schedule planned maintenance into aircraft rotations and consume qualified
  maintenance capacity.
- Generate deterministic bounded unscheduled faults with delay or grounding
  outcomes and repair requirements.
- Post maintenance and repair costs through the ledger.
- Forecast due work, downtime, deferral consequences, and schedule conflicts.

## Out of scope

- Spare-part inventory or component-level engineering.
- Fatal accidents, hull loss, or passenger injury.
- Heavy maintenance outsourcing marketplace depth.

## Acceptance criteria

- Flight completion increments hours and cycles exactly once.
- Overdue hard-limit work prevents unsafe dispatch and explains recovery steps.
- Planned maintenance blocks conflicting flight assignment.
- Fault outcomes are reproducible from the persisted seed/input snapshot.
- Maintenance history is append-only and cost postings reconcile to the ledger.

## References

- ADR-0016: Utilization-based maintenance.
- ADR-0017: Non-fatal safety consequences.
- ADR-0053: Real-time aircraft age and utilization-driven wear.

## Comments

None yet.
