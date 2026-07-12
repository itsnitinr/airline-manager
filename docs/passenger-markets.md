# Direct passenger markets

Ticket 11 implements the commercial simulation for direct economy travel. It
does not define routes, timetables, rotations, operational flights, individual
passengers, or fully operated competitor airlines.

## Published inputs and provenance

`market_ruleset_versions` binds each career world to immutable demand,
competition, and pricing formula versions plus one stable seed. The offline
`market-rules-v1.json` fixture is balance data, not a live-market dataset.
Directed `passenger_markets` bind origin and destination to the career's
published airport catalog, world ruleset, and market ruleset.

The demand forecast exposes these material inputs and their provenance:

- market size: a balance value calibrated for the single career ruleset;
- directionality: a stable seeded derived value for the directed airport pair;
- seasonality: a versioned month-of-year balance curve;
- airport attractiveness: derived from published playable-airport inputs;
- market growth: a stable seeded balance value; and
- an explicit uncertainty range, because the forecast is not sourced live fact.

The same catalog, ruleset, seed, directed pair, and timestamp generates the same
forecast and aggregate-competition snapshot.

## Segment response

Demand is aggregated into business, leisure, and visiting-friends-and-relatives
(`vfr`) segments. Sensitivities are integer basis-point balance values:

| Segment | Price | Schedule | Duration | Service | Reputation | Competition |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Business | 3,200 | 8,500 | 7,500 | 5,500 | 6,000 | 6,500 |
| Leisure | 8,500 | 3,500 | 3,000 | 2,500 | 3,000 | 7,500 |
| VFR | 7,000 | 4,500 | 4,000 | 3,000 | 3,500 | 6,000 |

Within the documented clamps, higher fares, weaker schedules, longer duration,
lower service/reputation, and stronger competition cannot increase the affected
segment's allocation. Property tests cover these monotonic relationships.

## Competition and pricing

Competition snapshots contain only aggregate capacity, fare pressure, schedule
quality/frequency, and service quality. The API labels them
`simulated_aggregate_market_pressure`; they do not imply hidden airline fleets
or schedules.

Economy inventory uses saver, standard, and flex booking classes. Beginners can
use the balanced recommendation. Advanced pricing versions set posture, exact
minor-unit base/minimum/maximum fares, load-factor target, and revenue target.
Versions are append-only and effective-dated. Each booking checkpoint retains
the pricing version and realized fare mix that applied to its elapsed interval,
so later pricing never rewrites accrued history.

## Commercial offer boundary

`MarketService.createCommercialOffer` is the framework-independent ticket 12
integration boundary. Ticket 12 must supply its opaque dated-flight UUID and
source reference in the same command that persists the commercial offer.
Ticket 11 stores economy sellable capacity, booking horizon, departure/arrival
timing, duration, schedule/service/reputation inputs, and immutable catalog and
ruleset references. It deliberately has no partial route, timetable, or
rotation schema. Deterministic integration fixtures use the same boundary with
`sourceType: ticket11_fixture`.

## Booking checkpoints and settlement handoff

Booking refresh locks the commercial offer, derives demand only for the elapsed
period since `last_checkpoint_at`, caps allocation by remaining economy seats,
and appends an immutable checkpoint. Retrying the same interval returns its
existing checkpoint, including when delivery uses a different retry key.
Concurrent refreshes serialize in PostgreSQL, and database constraints provide
a second capacity ceiling.

Each checkpoint stores aggregate segment/booking-class passengers, exact
realized fare and revenue, cumulative totals, and a versioned material-input
snapshot for ticket 17. Ticket 11 never posts passenger revenue to the ledger;
settlement owns that transition.

## Query surface

Authenticated, ownership-checked APIs provide direct route research, demand
forecast, recommended and effective-dated pricing, commercial-offer creation,
booking refresh, pace, load factor, yield, segment mix, competition, immutable
checkpoint history, and explanations. All inputs are offline and deterministic;
there is no live fare, passenger, competitor, or airline-schedule dependency.
