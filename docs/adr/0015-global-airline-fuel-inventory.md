# ADR-0015: Abstract fuel into a global airline inventory

Status: accepted

## Context

Airport-local fuel purchasing, storage, delivery, reserves, and tankering would
be operationally realistic but introduce substantial logistics complexity. The
player wants fuel-price strategy without that operational burden in the initial
game.

## Decision

Purchased fuel will enter a fungible airline-wide inventory. Flight operations
consume measured quantities from that inventory regardless of the airport at
which the aircraft is located. Airport-level inventory and delivery logistics
will not be simulated initially.

The global inventory has finite storage capacity. Airlines can expand that
capacity through investment. Exact initial capacity, upgrade steps, and any
recurring carrying costs are balance parameters rather than architecture
decisions.

Physical fuel burn may still depend on aircraft, payload, distance, and other
operational inputs. The global inventory is an explicit gameplay abstraction,
not a claim about real airline fuel handling.

## Consequences

- Players can buy fuel when market prices are favorable without managing each
  airport separately.
- The simulation needs clear units, purchase lots, valuation, and consumption
  records.
- Capacity limits prevent effectively unlimited speculation during temporary
  low-price periods and create a capital tradeoff.
- Airport fuel availability, tankering, and local price differences are absent.
