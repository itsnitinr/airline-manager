# ADR-0039: Advance simulation through milestones and reconciliation

Status: accepted

## Context

A per-second or per-minute tick across every airline, flight, booking market,
and aircraft would waste computation and become difficult to scale. Relying only
on precise queue delivery would make missed, delayed, or duplicate jobs threaten
authoritative game state.

## Decision

The backend schedules discrete simulation milestones for transitions such as
departure, arrival, aircraft delivery, maintenance completion, and contract
payment. Periodic reconciliation queries authoritative state for overdue or
missing milestones and advances them safely.

Continuous effects such as booking accumulation are calculated from persisted
checkpoints and elapsed time when refreshed or at relevant milestones. Every
transition is idempotent and safe to retry.

## Consequences

- The system performs work proportional to meaningful changes rather than wall
  clock ticks across all entities.
- Database state determines whether a queued job is still eligible to act.
- Reconciliation metrics and lag alerts become operational requirements.
- Simulation formulas need deterministic time inputs rather than direct ambient
  clock reads throughout domain code.
