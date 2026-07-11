# ADR-0001: Start single-player with a multiplayer-ready domain

Status: accepted

## Context

A persistent multiplayer airline economy adds synchronization, fairness,
anti-abuse, moderation, availability, and live-operations requirements before
the core simulation has been proven. A purely single-player model, however,
could embed assumptions that make a future shared world prohibitively costly.

## Decision

The initial product will be single-player. The core domain will nevertheless
model explicit ownership and world boundaries so that multiple player-owned
airlines can later coexist in a shared world.

This decision does not commit the initial release to multiplayer infrastructure
or multiplayer-specific gameplay.

## Consequences

- The first release can focus on validating the airline simulation and gameplay
  loop.
- Domain records must not assume there is only one airline or one possible
  owner globally.
- Market and simulation concepts should be scoped to an explicit game world or
  equivalent boundary.
- Multiplayer synchronization, competition rules, and anti-abuse systems are
  deferred.
