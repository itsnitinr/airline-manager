# ADR-0023: Enforce traffic-rights boundaries without permit administration

Status: accepted

## Context

International air-service rights are governed by complex bilateral and
multilateral arrangements. Reproducing treaty negotiation and route permits
would require extensive legal reference data and add administrative gameplay.
Ignoring jurisdiction entirely would permit obviously implausible foreign
domestic networks.

## Decision

Each airline has a home jurisdiction. Ordinary domestic and international
passenger and cargo authority is granted automatically when the airline meets
the relevant capability requirements. The contemporary default ruleset blocks
foreign domestic cabotage.

Bilateral treaty research, route-right negotiation, and permit paperwork are
not simulated initially.

## Consequences

- The game enforces a recognizable regulatory boundary with little player
  administration.
- Route validation needs origin, destination, airline jurisdiction, and world
  ruleset inputs.
- Capability requirements can still represent broad certification or safety
  prerequisites.
- A future ruleset may add regions, agreements, or explicit fifth-freedom rights
  without changing real airport geography.
