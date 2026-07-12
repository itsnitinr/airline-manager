# Generated weather and operational planning

Ticket 15 owns offline, deterministic weather inputs and immutable route/departure planning snapshots. It does not dispatch, settle, cancel, or consume resources for a flight.

## Material versions and reproduction

- `slice-one-climate-v1` supplies a provenance-tracked climate profile for every airport in the published slice-one catalog. Profiles are gameplay-derived from the catalog's pinned geography, elevation, region, and hemisphere; they are not certified climatology or navigation data.
- `weather-v1` fixes the world seed, `geographic-weather-v1` formula, six-hour system bucket, ten-degree correlation cell, physical/gameplay bounds, and `seeded-lead-spread-v1` uncertainty process.
- Forecast identity includes world seed, world/weather ruleset versions, climate-data version, endpoint profiles, issue time, valid time, and scope. These material inputs and their hash are retained with the immutable snapshot.
- Nearby airports in the same geographic cell share interpolated seeded system fields. Adjacent six-hour buckets interpolate continuously. Latitude, hemisphere, climate zone, and wet-season peak provide explicit seasonality.
- Forecast uncertainty grows monotonically with lead time. Realized conditions are recalculated from the same persisted base inputs using only the documented seeded uncertainty channel, so retries cannot invent a different outcome.

## Bounded planning effects

Weather returns endpoint conditions plus explainable route modifiers. Wind is bounded to 0-65 kt and visibility to 800-25,000 m. Runway capacity remains 4,000-10,000 basis points, block time 9,000-13,500, fuel burn 9,500-12,500, and reliability 8,000-10,000. Congestion/delay and diversion risks are also bounded and never represent fatal accidents, passenger injury, or hull loss.

The fuel-burn result is an advisory multiplier for ticket 10's planning forecast; it does not consume global inventory. The reliability result is an operational modifier alongside ticket 14's aircraft dispatch reliability; it does not mutate aircraft condition. Route/departure forecast queries persist snapshots without changing ticket 12 route, timetable, or dated-flight facts.

## Persistence and future runtime boundaries

Forecast and realized snapshots are append-only. A unique material key makes retried/concurrent forecast requests idempotent. A departure forecast writes `weather.realization_due.v1` checkpoint intent, but ticket 16 remains responsible for any future delivery/reconciliation runtime. Ticket 17 may retain or reference the snapshot IDs and material inputs during flight settlement; ticket 15 does not implement lifecycle transitions or ledger/fuel postings.
