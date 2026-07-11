# ADR-0026: Compress strategic terms without accelerating operations

Status: accepted

## Context

Flights have been accepted at approximately 1:1 real duration. Literal
real-world lease and loan terms lasting several years would rarely mature during
a playable career and would make contract choice irrelevant.

A single accelerated game calendar would conflict with real-duration flights
and make aircraft utilization difficult to explain.

## Decision

Physical operations use real elapsed time. Flight duration, turnaround,
aircraft hours, and cycles are based on actual scheduled operation.

Long commitments such as leases and loans use explicit gameplay-compressed
strategic terms measured in real days, with candidate terms such as 7, 30, or
90 days. The exact options are balance data.

## Consequences

- Contracts can expire and be renegotiated within normal player engagement.
- The game must label real-time duration clearly rather than presenting a
  misleading accelerated calendar date.
- Calendar-driven maintenance needs explicitly balanced real-day thresholds,
  while hours and cycles remain operational measures.
- Pricing and comparison views must annualize or normalize terms carefully to
  avoid misleading players.
