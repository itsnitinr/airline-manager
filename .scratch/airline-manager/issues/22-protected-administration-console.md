# Build the protected administration console

Type: task
Status: open
Blocked by: 05, 07, 16, 18, 19

## Goal

Operate reference data, rulesets, jobs, airlines, flights, and corrections
without direct production database edits.

## Scope

- Implement independent administrator authorization and reauthentication for
  sensitive actions.
- Build source import, validation comparison, quarantine, curation, and catalog
  promotion workflows.
- Build derived/balance value editing with version history and ruleset
  activation.
- Add read-only inspection for accounts, airlines, aircraft, schedules, flights,
  inventory, workforce, maintenance, notifications, outbox, jobs, and ledger.
- Add safe retry/reconciliation controls that invoke normal idempotent handlers.
- Add explicit adjusting/reversing financial operations with mandatory reason;
  never allow direct ledger or settlement mutation.
- Record actor, time, reason, target, command, before/after references, and
  outcome for every administrative write or sensitive read.

## Out of scope

- General-purpose SQL execution.
- Silent edits to published catalogs, settled flights, or posted journals.
- Player-accessible admin roles.

## Acceptance criteria

- Ordinary player sessions cannot access admin routes or data.
- Catalog publication and ruleset activation are versioned, reviewed actions.
- Retrying a job through admin cannot duplicate its effects.
- Every admin write and sensitive inspection has an immutable audit record.
- Corrections preserve original state and create explicit adjustment history.

## References

- ADR-0033 and ADR-0034: Provenance and curated promotion.
- ADR-0038: Immutable settlement and ledger history.
- ADR-0048: Protected audited administration.

## Comments

None yet.
