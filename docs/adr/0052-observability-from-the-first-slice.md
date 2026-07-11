# ADR-0052: Include observability in the first playable slice

Status: accepted

## Context

Persistent simulation crosses HTTP commands, database transactions, outbox
delivery, Redis jobs, workers, reconciliation, notifications, and SSE. A player
may report an incorrect outcome hours after the initiating action. Plain text
logs or direct database inspection would make diagnosis slow and risky.

## Decision

Slice one includes:

- Structured logs with correlation across commands, outbox events, jobs, and
  worker transitions.
- Metrics for job lag, reconciliation backlog, failed transitions, operational
  suspensions, ledger-posting failures, and SSE health.
- Error tracking with source-map context.
- API and worker health and readiness checks.
- Protected admin diagnostics for jobs and simulation state.

Sensitive authentication data and unnecessary personal information are not
logged.

## Consequences

- Correlation and causation identifiers are part of command and job envelopes.
- Alert thresholds need tuning as real workload becomes known.
- Operational dashboards and runbooks accompany simulation milestones.
- Logging and diagnostics require retention, access, and redaction policies
  before public launch.
