# Airline Manager Domain Context

## Product vision

Airline Manager is a web-based management game in which a player starts and
operates an airline. The game prioritizes operational and economic realism.
Its primary audience is airline and aviation enthusiasts, but it must remain
approachable to players who do not begin with specialist knowledge.
The visual language resembles a modern airline operations center: map-anchored,
serious, premium, information-dense, and operationally legible.

## Confirmed domain language

- **Airline**: The player-operated business that owns or leases aircraft and
  operates routes.
- **Player account**: The persistent player identity, distinct from any one
  airline the player creates.
- **Career**: The primary constrained game mode in which an airline begins with
  limited capital and can succeed or become insolvent through player decisions.
- **Insolvency**: The state in which an airline can no longer meet its financial
  obligations and must enter a failure or recovery flow.
- **Capability**: An airline's demonstrated ability to perform an operation,
  derived from finances, assets, staff, safety, reputation, and regulatory
  standing rather than an abstract player level.
- **Business model**: The observable strategy that emerges from an airline's
  network, fleet, cabin, service, fare, baggage, and cargo decisions; it is not
  a fixed class selected at airline creation.
- **Aircraft type**: A real-world aircraft model with operational and economic
  characteristics.
- **Aircraft variant**: The specific certificated or marketed version used as
  the simulation's type-level unit, such as distinct ceo and neo variants,
  rather than an undifferentiated aircraft family.
- **Aircraft**: An individual fleet asset of a real-world aircraft type.
- **Fleet**: The aircraft controlled by an airline.
- **Location**: A real-world airport that can participate in the route network.
- **Playable airport**: A location admitted to gameplay because it supports
  scheduled commercial operations and has sufficient trustworthy operational
  reference data.
- **Route**: A player-created air service between real-world locations.
- **Flight leg**: One scheduled movement from an origin airport to a destination
  airport at defined departure and arrival times.
- **Timetable**: A recurring weekly plan of flight legs offered by an airline.
- **Aircraft rotation**: The ordered assignment of a specific aircraft through
  flight legs, turnaround periods, positioning, and maintenance windows.
- **Turnaround**: The time and ground activity required between an aircraft's
  arrival and its next departure.
- **Fuel**: A purchased operating resource consumed by flights.
- **Fuel inventory**: Airline-wide fungible fuel stock available to the
  airline's flights regardless of airport; airport storage and delivery are a
  deliberate gameplay abstraction.
- **Fuel storage capacity**: The maximum quantity an airline can hold in its
  global fuel inventory; it is a limited, expandable airline asset.
- **Maintenance**: Work required to keep aircraft serviceable.
- **Maintenance program**: The scheduled work required for an aircraft, driven
  by flight hours, flight cycles, calendar limits, and its aircraft variant.
- **Maintenance package**: A planned group of maintenance tasks that consumes
  capacity and grounds an aircraft for a period of time.
- **Aircraft condition**: A summarized operational state influencing dispatch
  reliability and unscheduled fault risk; it is not an inventory of every
  physical component.
- **Unscheduled fault**: A condition discovered outside planned maintenance that
  may delay or ground an aircraft until repaired.
- **Safety standing**: The airline's regulatory and operational safety state,
  affected by maintenance, reliability, incidents, and compliance; it does not
  include simulated fatal accidents.
- **Workforce pool**: Aggregated staff capacity sharing a role, base, and
  qualification; individual employees are not simulation entities.
- **Type rating**: The aircraft-variant or family qualification required for a
  pilot pool to operate applicable aircraft.
- **Aircraft acquisition**: Obtaining an aircraft through a new order, lease,
  or used-aircraft purchase, subject to availability, financing, and a
  gameplay-compressed delivery delay.
- **Founder lease package**: The subsidized operating lease for one starter
  aircraft selected when a new career airline is established.
- **Founder equity**: Standardized initial working capital provided to a new
  career airline; it is not debt and is sized to fund a reasonable starter
  operating runway.
- **Creditworthiness**: The airline's ability to obtain and price debt, derived
  from collateral, profitability, leverage, safety, and repayment history.
- **Operational time**: Real elapsed time used for flights, turnarounds, and
  utilization; scheduled flight durations run approximately 1:1.
- **Strategic term**: A gameplay-compressed duration measured in real days for
  long commitments such as leases and loans.
- **Accounting ledger**: The immutable double-entry record from which airline
  balances, profit, assets, liabilities, and cash flow are derived.
- **Reporting currency**: The currency selected for an airline's financial
  statements; it does not erase the original currency of a transaction.
- **Cabin configuration**: An aircraft's allocation of cabin capacity by travel
  class and density, constrained by its variant and affecting weight, comfort,
  demand, revenue, service, and turnaround.
- **Simulated weather**: Internally generated, geographically and seasonally
  plausible operating conditions with forecast uncertainty; it is not a live
  real-world weather feed.
- **Operational suspension**: Automatic prevention of future affected flights
  when fuel, cash, staff, maintenance, or another hard requirement is
  unavailable; it is safer and bounded compared with allowing an invalid
  schedule to compound indefinitely.
- **Game notification**: A persisted player-facing record of an operational,
  financial, or account event, independent of optional delivery channels.
- **Catalog promotion**: The audited act of publishing validated reference data
  or balance data into a versioned playable ruleset.
- **Administrative action**: A privileged, attributed command used to curate
  data, inspect state, or recover operations without silently rewriting settled
  history.
- **Assistance setting**: Player-selected guidance, warning, or automation that
  operates on the same economic and simulation rules as every other career.
- **Vertical slice**: A deployable increment that delivers a complete playable
  path through the production web, API, database, worker, and simulation layers.
- **First playable slice**: The initial direct-passenger career path using one
  founder-leased aircraft and an economy cabin to validate the full persistent
  flight lifecycle.
- **Production status**: Versioned aircraft-variant reference data that controls
  default acquisition channels in a contemporary world.
- **World ruleset**: Versioned rules applied to a career world that may
  explicitly override gameplay eligibility without altering real-world
  reference facts.
- **Reference data**: Real-world facts about aircraft types, airports, and
  geography used as inputs to the simulation.
- **Sourced fact**: Reference data taken from an identified external source with
  provenance and an effective date.
- **Derived simulation value**: A modeled value calculated or calibrated from
  evidence when an exact operational value is unavailable or variable.
- **Balance value**: An explicitly game-designed parameter tuned for viable and
  engaging play rather than represented as a real-world fact.
- **Playable reference record**: A sourced record that has passed validation,
  curation, and eligibility checks for use by a world ruleset.
- **Simulation worker**: A backend process separate from web request handling
  that advances scheduled and offline game state using authoritative persisted
  data.
- **Command**: An authenticated request to change airline or world state, such
  as purchasing fuel or activating a timetable.
- **Read model**: A query-oriented representation derived from authoritative
  state for dashboards, forecasts, and planning views.
- **Domain module**: A cohesive backend boundary that owns a portion of the
  airline model and exposes explicit application interfaces while remaining
  part of the same transactional system.
- **Transactional outbox**: Persisted events written in the same database
  transaction as authoritative state, then delivered asynchronously to workers,
  notifications, and read models.
- **Settled flight snapshot**: The immutable inputs and results retained when a
  flight is completed so later data or balance changes do not rewrite history.
- **Simulation milestone**: A scheduled discrete transition such as departure,
  arrival, aircraft delivery, maintenance completion, or contract payment.
- **Reconciliation**: Periodic backend work that finds overdue or missing
  milestone processing and safely advances it.
- **Simulated market**: Game-generated demand, fares, costs, and competitive
  conditions that are plausible but do not claim to reproduce the live airline
  market.
- **Aggregate competition**: Simulated competing capacity, pricing pressure,
  and service quality within a travel market without operating complete AI
  airlines, fleets, or timetables.
- **Travel market**: Passenger demand between an origin and destination,
  independent of any one route or flight offered by the player's airline.
- **Market segment**: An aggregate passenger category, such as business,
  leisure, or visiting-friends-and-relatives, with distinct preferences and
  price sensitivity.
- **Cargo market**: Aggregate freight demand between an origin and destination,
  expressed in weight, volume, category, and time sensitivity.
- **Cargo category**: A freight class such as general, express, perishable, or
  special cargo, with distinct handling and carriage constraints.
- **Booking**: Aggregated reserved demand allocated to a particular flight and
  cabin; it is not an individually persisted passenger.
- **Booking class**: A priced inventory bucket within a cabin used by revenue
  management; it is not a separate physical seat type.
- **Pricing strategy**: Player-defined fare posture, targets, and guardrails
  that guide booking-class availability and realized fares.
- **Itinerary**: The complete journey offered to a passenger, consisting of one
  direct flight leg or two flight legs joined by a valid connection.
- **Connection**: A transfer between two flight legs that satisfies airport,
  timing, and journey-validity rules.
- **Principal base**: The airline's initial primary operating location selected
  at founding.
- **Home jurisdiction**: The country or regulatory jurisdiction under which the
  airline is established and from which its default operating authority derives.
- **Cabotage**: Carriage between two points within a foreign jurisdiction;
  blocked by the contemporary default ruleset.
- **Station**: An airline's operational presence at an airport, ranging from
  outsourced service to invested facilities and dedicated capacity.
- **Operating base**: A station that supports based aircraft, workforce, and
  recurring originating operations.
- **Airport congestion**: Time-dependent pressure on airport operations,
  represented through fees, turnaround, delay risk, and schedule capacity
  rather than player-owned slot rights.

## Product constraints

- The initial client is web-based.
- The product has a real backend and persistent database.
- Aircraft types and locations represented by the game must exist in the real
  world.
- Fleet management, fuel purchasing, route creation, and aircraft maintenance
  are core gameplay areas.
- The first release is single-player.
- The domain model must preserve a path to multiple player-owned airlines in a
  shared world without requiring a rewrite of the core simulation.
- Simulation time continues while the player is offline and is authoritative
  on the server.
- A flight's operational duration runs at approximately 1:1 real time: an
  eight-hour real-world operation occupies its aircraft for roughly eight real
  hours, including separately modeled turnaround where applicable.
- The product exposes one consistent simulation through progressive disclosure:
  guided defaults make it approachable, while advanced controls expose deeper
  management of the same underlying systems.
- Realism means a plausible contemporary simulation grounded in real reference
  data, not a live replica of current airline schedules, fares, or competitors.
- Player airlines are fictional.
- The playable airport catalog is global but curated. An airport must meet
  explicit commercial relevance and data-completeness criteria; merely existing
  in a source dataset does not make it playable.
- The initial aircraft catalog is a curated modern commercial fleet modeled at
  variant level. It includes common passenger jets and turboprops plus factory
  freighters where reliable data exists. Historic classics, prototypes,
  military aircraft, helicopters, and private jets are initially excluded.
- The primary progression mode is a financially constrained career. A failed
  airline does not permanently trap or delete its player account; the player
  can found a new airline.
- Progression is capability-based. Aircraft, airports, and routes are not hidden
  behind arbitrary experience levels; practical and regulatory constraints
  determine whether the airline can use them.
- Airline archetypes are not locked choices. Low-cost, full-service, regional,
  cargo, and hybrid strategies emerge from independently changeable operating
  decisions.
- Core scheduling uses recurring weekly timetables and aircraft rotations.
  Activation validates time conflicts, physical feasibility, airport rules,
  aircraft position, turnaround, and maintenance windows.
- An airline begins with one principal base and may later open additional
  operating bases. It can serve other airports through outsourced handling,
  then invest in station facilities and capacity without constructing terminals.
- Players do not initially acquire or manage airport slots. Constrained airports
  instead apply congestion effects and backend-enforced scheduling ceilings.
- Traffic rights are simplified. Ordinary domestic and international authority
  is automatic when capability requirements are met, while foreign domestic
  cabotage is blocked by default. Treaty and permit administration is excluded.
- Passenger demand is simulated in aggregate by travel market, market segment,
  and cabin. Bookings build over time and respond to price, schedule, duration,
  service, and reputation without creating individual passenger agents.
- Passenger booking allocation considers direct itineraries and itineraries
  with one connection. Arbitrary multi-stop journeys are initially excluded.
- Cargo is aggregated by market and category. Both passenger-aircraft belly
  capacity and dedicated freighters serve the same cargo economy, subject to
  weight, volume, handling, timing, and aircraft constraints.
- Single-player competition is represented by aggregate market conditions, not
  fully simulated AI airlines. The model must later accept capacity supplied by
  real player airlines.
- Fare control is assisted but player-directed. Revenue management uses booking
  classes and booking pace while respecting player-selected strategies and, for
  advanced control, cabin-level fare bounds and targets.
- Fuel is purchased into a global airline inventory and consumed by flight
  operations. Airport-level fuel inventory and delivery logistics are not
  simulated initially.
- Global fuel storage has finite capacity that the airline can expand through
  investment.
- Maintenance includes line work, scheduled packages, and unscheduled faults.
  Requirements derive from hours, cycles, and calendar time. Individual parts
  and component-level engineering are initially excluded.
- The simulation does not generate crashes or passenger fatalities. Unsafe
  management instead causes operational incidents, groundings, regulatory and
  insurance consequences, financial loss, and reputational damage.
- Staffing uses workforce pools for pilots, cabin crew, maintenance, ground,
  and commercial roles. Qualifications, bases, training, wages, fatigue, and
  shortages matter; named employees and manual individual rostering do not.
- Fleet acquisition supports new orders, leases, used-aircraft purchases, and
  secured financing with market availability and aircraft history.
- Each new career chooses one aircraft from a curated founder lease package.
  The airline pays recurring lease obligations and does not receive a free
  owned aircraft or a freely saleable asset.
- A new airline receives standardized founder equity and may accept a modest
  optional loan. Later borrowing availability and terms depend on
  creditworthiness.
- Multi-year real-world commitments are compressed into strategic terms such as
  7, 30, or 90 real days. This does not accelerate physical flight time or
  aircraft utilization.
- Aircraft chronological age advances with real calendar time. Used-aircraft
  history provides initial age and wear; ongoing replacement pressure comes
  primarily from utilization, condition, reliability, and economics.
- Financial state is backed by double-entry accounting. Default reports are
  simplified, while advanced players may inspect full statements and entries.
- Financial transactions preserve original currency and applied exchange rate.
  Reports convert to one airline reporting currency. Active foreign-exchange
  trading and hedging are initially excluded.
- Cabins are configured by supported travel class, capacity, and density rather
  than an individual seat map. Reconfiguration costs money and grounds the
  aircraft for a defined period.
- Weather is generated by the game and may affect winds, airport capacity,
  delays, diversions, cancellations, and fuel burn. Players receive forecasts;
  live weather synchronization is excluded.
- Offline progression is consequential but bounded. Forecasts and reserve
  policies warn about shortages, and infeasible future operations suspend
  automatically while still causing defined financial and reputation effects.
- The initial release has one economic career ruleset. Assistance settings may
  change guidance and automation but not demand, costs, reliability, or finance
  rules.
- Delivery proceeds through production-quality vertical slices. Breadth is
  phased, but early slices are not disposable prototypes.
- The first playable slice is limited to direct passenger service with one
  economy cabin. Connections, dedicated cargo, advanced cabins, station
  investment, and full workforce depth enter later slices.
- The first playable catalog targets roughly 250 globally distributed,
  high-confidence commercial airports and four starter aircraft variants: one
  turboprop, one regional jet, and two familiar narrow-bodies.
- Founding and operating an airline requires an authenticated, verified player
  account. Slice one supports email/password and Google sign-in; anonymous
  persistent careers are excluded.
- The UI uses restrained aviation-inspired styling, rich planning visuals, and
  meaningful status colors. It is neither cartoonish, casino-like, nor a raw
  spreadsheet interface.
- The initial web experience is desktop-first for complex planning. Mobile web
  supports monitoring and safe simple actions; native apps and complex phone
  rotation editing are excluded initially.
- Slice one provides a persisted in-game notification center and optional
  browser notifications with severity and quiet-hour controls. Email
  notifications are deferred.
- Slice one includes protected administration for data curation, ruleset
  publication, state inspection, and safe job recovery. Administrative actions
  are audited and cannot silently mutate ledger or settled-flight history.
- Realism data distinguishes sourced facts, derived simulation values, and
  balance values. Estimates must not be presented as certified facts.
- Initial reference data uses open, redistributable sources plus manual
  curation. Raw imports are not automatically playable, and proprietary
  aviation databases are not scraped.
- The product uses a TypeScript monorepo with separate web, API, and simulation
  worker applications. PostgreSQL is authoritative; Redis-backed jobs coordinate
  background work but do not own game state.
- The web client uses versioned REST/OpenAPI commands and queries plus
  Server-Sent Events for live updates. Persisted state, not the event stream, is
  authoritative.
- The backend is a modular monolith. Domain modules share one deployable codebase
  and transactional database, with separate API and worker process entry points.
- Fastify is the backend HTTP framework. It remains a transport adapter around
  framework-independent application and domain services.
- PostgreSQL schema changes use explicit SQL migrations. Kysely provides typed
  query construction against generated database types without replacing
  PostgreSQL as the schema authority.
- Deployment is containerized and provider-neutral. Local development runs the
  complete web, API, worker, PostgreSQL, and Redis topology; production may use
  managed data services.
- Current game state uses normalized PostgreSQL records rather than full event
  sourcing. Important transitions also write a transactional outbox, audit
  history, and immutable settled-flight data.
- Persistent simulation uses queued milestones plus periodic reconciliation.
  Continuous effects are derived from elapsed time; the world does not run a
  per-second tick for every entity.
- BullMQ is the Redis-backed job transport. Jobs carry identifiers and expected
  versions, then re-read PostgreSQL before invoking idempotent transitions.
- Simulation time and randomness are explicit inputs. Deterministic settlement
  and domain invariants must hold under retry, delay, and reconciliation.
- Slice one includes correlated structured logs, operational metrics, error
  tracking, health checks, and admin diagnostics without logging sensitive
  authentication data.
- Aircraft delivery time is compressed for engagement: small aircraft may be
  delivered instantly, and no delivery takes more than 24 real hours.
- In the contemporary default, discontinued aircraft cannot be factory-ordered
  but may appear for lease or used purchase. This eligibility is data-driven so
  it can be changed in a future ruleset.
- Any future deviation from real production status is expressed as an explicit
  world-ruleset override, not a silent mutation of contemporary reference data.

## Unresolved language

The initial product grilling has resolved the core vocabulary and boundaries.
Implementation may reveal narrower terms that require addition through the same
domain-document and ADR process.
