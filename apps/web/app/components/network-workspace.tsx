"use client";

import type {
  GetRoutePlanningResponse,
  GetRouteWeatherForecastResponse,
  ListDirectRoutesResponse,
  ListFleetResponse,
  ListPassengerPricingStrategiesResponse,
  ResearchDirectRouteResponse,
  TimetableActivationRequest,
} from "@airline-manager/contracts";
import type { RouteWeatherPlan } from "@airline-manager/domain";
import {
  AirplaneTilt,
  ArrowRight,
  CalendarDots,
  CheckCircle,
  CloudSun,
  CurrencyDollar,
  MapPin,
  Plus,
  Trash,
  Warning,
} from "@phosphor-icons/react";
import {
  useDeferredValue,
  useState,
  useTransition,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { AirportMap, type AirportMapAirport } from "../map/airport-map";
import { WebApiError, createStableIdempotencyKey } from "../lib/client-api";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatPercent,
  nextLocalDate,
} from "../lib/planning-format";
import { planningApi } from "../lib/planning-api";
import { Button, Field, OperationalTable, ProvenanceLabel, StateMessage } from "./ui";

type LegDraft = TimetableActivationRequest["legs"][number] & { id: string };
type PricingDraft = Readonly<{
  posture: "value" | "balanced" | "yield";
  effectiveFrom: string;
  baseFareMinor: string;
  minimumFareMinor: string;
  maximumFareMinor: string;
  loadFactorTargetBasisPoints: number;
  revenueTargetMinor: string;
}>;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function NetworkWorkspace({
  airlineId,
  baseAirportId,
  reportingCurrency,
  airports,
  fleet,
  initialRoutes,
  initialPlanning,
  initialWeather,
  initialPricingStrategies,
  mapStyleUrl,
}: {
  airlineId: string;
  baseAirportId: string;
  reportingCurrency: string;
  airports: readonly AirportMapAirport[];
  fleet: ListFleetResponse;
  initialRoutes: ListDirectRoutesResponse;
  initialPlanning: GetRoutePlanningResponse | null;
  initialWeather: GetRouteWeatherForecastResponse | null;
  initialPricingStrategies: ListPassengerPricingStrategiesResponse;
  mapStyleUrl?: string;
}) {
  const base = airports.find(({ id }) => id === baseAirportId) ?? airports[0];
  const firstDestination = airports.find(({ id }) => id !== base?.id) ?? base;
  const [originId, setOriginId] = useState(base?.id ?? "");
  const [destinationId, setDestinationId] = useState(firstDestination?.id ?? "");
  const deferredDestinationId = useDeferredValue(destinationId);
  const [mapTarget, setMapTarget] = useState<"origin" | "destination">("destination");
  const [aircraftId, setAircraftId] = useState(fleet[0]?.id ?? "");
  const [research, setResearch] = useState<ResearchDirectRouteResponse | null>(null);
  const [routes, setRoutes] = useState(initialRoutes);
  const [planning, setPlanning] = useState(initialPlanning);
  const [weather, setWeather] = useState(initialWeather);
  const [pricingStrategies, setPricingStrategies] = useState(initialPricingStrategies);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [pricingDraft, setPricingDraft] = useState<PricingDraft | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(nextLocalDate(2));
  const [legs, setLegs] = useState<LegDraft[]>(() =>
    defaultLegs(base?.iataCode, firstDestination?.iataCode),
  );
  const [isPending, startTransition] = useTransition();

  const origin = airports.find(({ id }) => id === originId);
  const destination = airports.find(({ id }) => id === deferredDestinationId);
  const selectedRoute =
    origin && destination
      ? { originAirportId: origin.id, destinationAirportId: destination.id }
      : undefined;
  const activeResearch = research;
  const marketId = research?.market.marketId ?? planning?.route.marketId;

  async function researchRoute(event: FormEvent) {
    event.preventDefault();
    if (!origin || !destination || !aircraftId) return;
    setError(null);
    setConfirmation(null);
    startTransition(async () => {
      try {
        const result = await planningApi.researchRoute(airlineId, {
          origin: origin.iataCode,
          destination: destination.iataCode,
          aircraftId,
        });
        setResearch(result);
        const recommendation = result.market.recommendedPricing;
        setPricingDraft({
          posture: recommendation.posture,
          effectiveFrom: `${nextLocalDate(1)}T00:00:00.000Z`,
          baseFareMinor: recommendation.baseFareMinor,
          minimumFareMinor: recommendation.minimumFareMinor,
          maximumFareMinor: recommendation.maximumFareMinor,
          loadFactorTargetBasisPoints: recommendation.loadFactorTargetBasisPoints,
          revenueTargetMinor: recommendation.revenueTargetMinor,
        });
        setLegs(defaultLegs(origin.iataCode, destination.iataCode));
      } catch (cause) {
        setError(messageFor(cause));
      }
    });
  }

  function createRoute() {
    if (!origin || !destination || !aircraftId || !research?.valid) return;
    const fingerprint = `${origin.iataCode}|${destination.iataCode}|${aircraftId}`;
    const key = createStableIdempotencyKey(`ticket20:route:${airlineId}`, fingerprint);
    setError(null);
    startTransition(async () => {
      try {
        const created = await planningApi.createRoute(
          airlineId,
          {
            originIataCode: origin.iataCode,
            destinationIataCode: destination.iataCode,
            aircraftId,
          },
          key,
        );
        const [nextRoutes, nextPlanning] = await Promise.all([
          planningApi.listRoutes(airlineId),
          planningApi.routePlanning(airlineId, created.id),
        ]);
        setRoutes(nextRoutes);
        setPlanning(nextPlanning);
        setConfirmation(`Route AM${created.routeNumber} saved from authoritative research.`);
      } catch (cause) {
        setError(messageFor(cause));
      }
    });
  }

  function activateTimetable(event: FormEvent) {
    event.preventDefault();
    if (!planning) return;
    const body: TimetableActivationRequest = {
      aircraftId,
      effectiveFromLocalDate: effectiveDate,
      horizonDays: 28,
      legs: legs.map((leg) => ({
        dayOfWeek: leg.dayOfWeek,
        originIataCode: leg.originIataCode,
        destinationIataCode: leg.destinationIataCode,
        departureLocalTime: leg.departureLocalTime,
      })),
    };
    const fingerprint = JSON.stringify({ routeId: planning.route.id, body });
    const key = createStableIdempotencyKey(`ticket20:timetable:${planning.route.id}`, fingerprint);
    setError(null);
    startTransition(async () => {
      try {
        await planningApi.activateTimetable(airlineId, planning.route.id, body, key);
        const refreshed = await planningApi.routePlanning(airlineId, planning.route.id);
        setPlanning(refreshed);
        setConfirmation(
          `Timetable version ${refreshed.timetable?.version ?? ""} activated prospectively.`,
        );
      } catch (cause) {
        setError(messageFor(cause));
      }
    });
  }

  function savePricing(event: FormEvent) {
    event.preventDefault();
    if (!pricingDraft || !marketId) return;
    const body = { marketId, ...pricingDraft };
    const key = createStableIdempotencyKey(`ticket20:pricing:${marketId}`, JSON.stringify(body));
    setError(null);
    startTransition(async () => {
      try {
        const result = await planningApi.updatePricing(airlineId, body, key);
        setPricingStrategies((current) =>
          [result, ...current.filter(({ id }) => id !== result.id)].sort((left, right) =>
            right.effectiveFrom.localeCompare(left.effectiveFrom),
          ),
        );
        setConfirmation(
          `Pricing strategy v${result.version} takes effect ${formatDate(result.effectiveFrom)}.`,
        );
      } catch (cause) {
        setError(messageFor(cause));
      }
    });
  }

  function refreshWeather() {
    if (!planning) return;
    const validAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    startTransition(async () => {
      try {
        setWeather(await planningApi.routeWeather(airlineId, planning.route.id, validAt));
      } catch (cause) {
        setError(messageFor(cause));
      }
    });
  }

  return (
    <div className="network-planner">
      <div className="network-map-layer">
        <AirportMap
          airports={airports}
          selectedAirportIds={[originId, destinationId].filter(Boolean)}
          {...(selectedRoute ? { route: selectedRoute } : {})}
          {...(mapStyleUrl ? { styleUrl: mapStyleUrl } : {})}
          label="Direct route research map"
          interactive
          presentation="shell"
          onSelect={(airportId) =>
            mapTarget === "origin" ? setOriginId(airportId) : setDestinationId(airportId)
          }
        />
      </div>

      <section className="planning-inspector" aria-labelledby="route-research-title">
        <header className="inspector-intro">
          <p className="context-label">Direct network research</p>
          <h2 id="route-research-title">Build one defensible route</h2>
          <p>Catalog facts, market simulation, and scheduling constraints share one audit trail.</p>
        </header>

        {error ? (
          <StateMessage tone="critical" title="Planning action blocked">
            {error} <a href="/app?view=fleet">Fleet recovery</a>,{" "}
            <a href="/app?view=workforce">workforce recovery</a>, or{" "}
            <a href="/app?view=maintenance">maintenance recovery</a>.
          </StateMessage>
        ) : null}
        {confirmation ? (
          <StateMessage tone="nominal" title="Authoritative state refreshed">
            {confirmation}
          </StateMessage>
        ) : null}

        <form className="route-research-form" onSubmit={researchRoute}>
          <div className="map-target-switch" role="group" aria-label="Map selection target">
            <button
              type="button"
              aria-pressed={mapTarget === "origin"}
              onClick={() => setMapTarget("origin")}
            >
              <MapPin aria-hidden /> Set origin on map
            </button>
            <button
              type="button"
              aria-pressed={mapTarget === "destination"}
              onClick={() => setMapTarget("destination")}
            >
              <MapPin aria-hidden /> Set destination on map
            </button>
          </div>
          <div className="route-pair">
            <Field label="Origin" htmlFor="route-origin" hint="Published playable airport">
              <select
                id="route-origin"
                value={originId}
                onChange={(event) => setOriginId(event.target.value)}
              >
                {airports.map((airport) => (
                  <option key={airport.id} value={airport.id}>
                    {airport.iataCode} — {airport.name}
                  </option>
                ))}
              </select>
            </Field>
            <ArrowRight aria-hidden />
            <Field
              label="Destination"
              htmlFor="route-destination"
              hint="Map selection has a list equivalent"
            >
              <select
                id="route-destination"
                value={destinationId}
                onChange={(event) => setDestinationId(event.target.value)}
              >
                {airports.map((airport) => (
                  <option key={airport.id} value={airport.id}>
                    {airport.iataCode} — {airport.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label="Aircraft"
            htmlFor="route-aircraft"
            hint="Range and runway are validated by the API"
          >
            <select
              id="route-aircraft"
              value={aircraftId}
              onChange={(event) => setAircraftId(event.target.value)}
            >
              {fleet.map((aircraft) => (
                <option key={aircraft.id} value={aircraft.id}>
                  {aircraft.manufacturer} {aircraft.model} · {aircraft.deliveryState}
                </option>
              ))}
            </select>
          </Field>
          <Button
            className="button-primary"
            type="submit"
            disabled={isPending || originId === destinationId}
          >
            {isPending ? "Refreshing forecast…" : "Research direct route"}
          </Button>
        </form>

        {activeResearch ? (
          <ResearchResult
            research={activeResearch}
            currency={activeResearch.forecast.currency || reportingCurrency}
            onCreate={createRoute}
            canCreate={Boolean(research?.valid) && !isPending}
          />
        ) : (
          <div className="inspector-empty">
            <AirplaneTilt aria-hidden />
            <strong>No route compared yet</strong>
            <p>
              Select both airports using the map or accessible lists, then request the backend
              forecast.
            </p>
          </div>
        )}
      </section>

      <section
        className={`planning-workbench${planning ? "" : " planning-workbench-empty"}`}
        aria-label="Route and timetable workbench"
        tabIndex={planning ? undefined : 0}
      >
        <header className="workbench-heading">
          <div>
            <p className="context-label">Desktop planning workbench</p>
            <h2>Pricing, rotation, and weather</h2>
          </div>
          <span>
            {routes.length} saved route{routes.length === 1 ? "" : "s"}
          </span>
        </header>

        {!planning ? (
          <StateMessage tone="warning" title="Save a valid route first">
            The timetable, route weather, and pricing history require a persisted route. Return to
            route research and resolve every server constraint.
          </StateMessage>
        ) : (
          <>
            <RouteSummary planning={planning} />
            <div className="workbench-columns">
              <form
                className="pricing-editor"
                onSubmit={savePricing}
                aria-labelledby="pricing-title"
              >
                <header>
                  <CurrencyDollar aria-hidden />
                  <div>
                    <h3 id="pricing-title">Economy pricing posture</h3>
                    <p>Effective-dated; accrued bookings remain unchanged.</p>
                  </div>
                </header>
                {pricingDraft ? (
                  <>
                    <Field label="Posture" htmlFor="pricing-posture">
                      <select
                        id="pricing-posture"
                        value={pricingDraft.posture}
                        onChange={(event) =>
                          setPricingDraft({
                            ...pricingDraft,
                            posture: event.target.value as PricingDraft["posture"],
                          })
                        }
                      >
                        <option value="value">Value</option>
                        <option value="balanced">Balanced</option>
                        <option value="yield">Yield</option>
                      </select>
                    </Field>
                    <div className="pricing-grid">
                      <MoneyField
                        label="Base fare"
                        id="base-fare"
                        value={pricingDraft.baseFareMinor}
                        onChange={(baseFareMinor) =>
                          setPricingDraft({ ...pricingDraft, baseFareMinor })
                        }
                      />
                      <MoneyField
                        label="Minimum"
                        id="minimum-fare"
                        value={pricingDraft.minimumFareMinor}
                        onChange={(minimumFareMinor) =>
                          setPricingDraft({ ...pricingDraft, minimumFareMinor })
                        }
                        advanced
                      />
                      <MoneyField
                        label="Maximum"
                        id="maximum-fare"
                        value={pricingDraft.maximumFareMinor}
                        onChange={(maximumFareMinor) =>
                          setPricingDraft({ ...pricingDraft, maximumFareMinor })
                        }
                        advanced
                      />
                      <div className="advanced-pricing-control">
                        <Field
                          label="Load target"
                          htmlFor="load-target"
                          hint="Basis points; 8,200 = 82%"
                        >
                          <input
                            id="load-target"
                            inputMode="numeric"
                            value={pricingDraft.loadFactorTargetBasisPoints}
                            onChange={(event) =>
                              setPricingDraft({
                                ...pricingDraft,
                                loadFactorTargetBasisPoints: Number(
                                  event.target.value.replace(/\D/g, ""),
                                ),
                              })
                            }
                          />
                        </Field>
                      </div>
                      <MoneyField
                        label="Revenue target"
                        id="revenue-target"
                        value={pricingDraft.revenueTargetMinor}
                        onChange={(revenueTargetMinor) =>
                          setPricingDraft({ ...pricingDraft, revenueTargetMinor })
                        }
                        advanced
                      />
                    </div>
                    <Field
                      label="Effective from"
                      htmlFor="pricing-effective"
                      hint="Prospective UTC instant"
                    >
                      <input
                        id="pricing-effective"
                        type="datetime-local"
                        value={pricingDraft.effectiveFrom.slice(0, 16)}
                        onChange={(event) =>
                          setPricingDraft({
                            ...pricingDraft,
                            effectiveFrom: new Date(event.target.value).toISOString(),
                          })
                        }
                      />
                    </Field>
                    <Button className="button-primary" type="submit" disabled={isPending}>
                      Save prospective strategy
                    </Button>
                    <details className="pricing-guidance">
                      <summary>Recommendation, booking classes, and guardrails</summary>
                      <p>{research?.market.recommendedPricing.recommendation}</p>
                      <ul>
                        <li>
                          Economy Saver — bounded below the base fare for early leisure demand.
                        </li>
                        <li>Economy Standard — follows the active posture and booking pace.</li>
                        <li>Economy Flex — bounded above base fare for late, flexible demand.</li>
                      </ul>
                      <p>
                        The backend derives class fares from posture, time to departure, load pace,
                        and revenue progress, then clamps every value to the active fare bounds.
                      </p>
                    </details>
                    {pricingStrategies.length ? (
                      <OperationalTable label="Current and prospective pricing periods">
                        <thead>
                          <tr>
                            <th>Version</th>
                            <th>Effective period</th>
                            <th>Posture</th>
                            <th>Base fare</th>
                            <th>Targets</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pricingStrategies.map((strategy) => (
                            <tr key={strategy.id}>
                              <th scope="row">v{strategy.version}</th>
                              <td>
                                {formatDateTime(strategy.effectiveFrom)} →{" "}
                                {typeof strategy.effectiveTo === "string"
                                  ? formatDateTime(strategy.effectiveTo)
                                  : "open-ended"}
                              </td>
                              <td>{strategy.posture}</td>
                              <td>{formatMoney(strategy.baseFareMinor, strategy.currency)}</td>
                              <td>
                                {formatPercent(strategy.loadFactorTargetBasisPoints)} load ·{" "}
                                {formatMoney(strategy.revenueTargetMinor, strategy.currency)}{" "}
                                revenue
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </OperationalTable>
                    ) : null}
                  </>
                ) : (
                  <p>Run route research to load the backend recommendation and guardrails.</p>
                )}
              </form>

              <section className="weather-panel" aria-labelledby="weather-title">
                <header>
                  <CloudSun aria-hidden />
                  <div>
                    <h3 id="weather-title">Planning weather</h3>
                    <p>Generated simulation snapshot, never live weather.</p>
                  </div>
                </header>
                {weather ? (
                  <WeatherSummary weather={weather} />
                ) : (
                  <p>No route-weather snapshot requested.</p>
                )}
                <Button
                  className="button-secondary"
                  type="button"
                  onClick={refreshWeather}
                  disabled={isPending}
                >
                  Refresh +24h forecast
                </Button>
              </section>
            </div>

            <form
              className="rotation-editor"
              onSubmit={activateTimetable}
              aria-labelledby="rotation-title"
            >
              <header>
                <div>
                  <p className="context-label">Single-aircraft weekly rotation</p>
                  <h3 id="rotation-title">Local-time leg templates</h3>
                </div>
                <CalendarDots aria-hidden />
              </header>
              <div className="desktop-only-editor">
                <div className="rotation-toolbar">
                  <Field
                    label="Effective local date"
                    htmlFor="timetable-effective"
                    hint="Must be prospective"
                  >
                    <input
                      id="timetable-effective"
                      type="date"
                      value={effectiveDate}
                      onChange={(event) => setEffectiveDate(event.target.value)}
                    />
                  </Field>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() =>
                      setLegs((current) => [
                        ...current,
                        {
                          id: crypto.randomUUID(),
                          dayOfWeek: 1,
                          originIataCode: planning.route.origin.iataCode,
                          destinationIataCode: planning.route.destination.iataCode,
                          departureLocalTime: "09:00",
                        },
                      ])
                    }
                  >
                    <Plus aria-hidden /> Add leg
                  </button>
                </div>
                <div className="weekly-grid" role="group" aria-label="Weekly leg templates">
                  {legs.map((leg, index) => (
                    <div className="leg-row" key={leg.id}>
                      <span className="leg-sequence">{String(index + 1).padStart(2, "0")}</span>
                      <select
                        aria-label={`Leg ${index + 1} day`}
                        value={leg.dayOfWeek}
                        onChange={(event) =>
                          updateLeg(setLegs, leg.id, { dayOfWeek: Number(event.target.value) })
                        }
                      >
                        {DAYS.map((day, dayOfWeek) => (
                          <option value={dayOfWeek} key={day}>
                            {day}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`Leg ${index + 1} origin`}
                        value={leg.originIataCode}
                        onChange={(event) =>
                          updateLeg(setLegs, leg.id, { originIataCode: event.target.value })
                        }
                      >
                        <option>{planning.route.origin.iataCode}</option>
                        <option>{planning.route.destination.iataCode}</option>
                      </select>
                      <ArrowRight aria-hidden />
                      <select
                        aria-label={`Leg ${index + 1} destination`}
                        value={leg.destinationIataCode}
                        onChange={(event) =>
                          updateLeg(setLegs, leg.id, { destinationIataCode: event.target.value })
                        }
                      >
                        <option>{planning.route.destination.iataCode}</option>
                        <option>{planning.route.origin.iataCode}</option>
                      </select>
                      <input
                        aria-label={`Leg ${index + 1} local departure`}
                        type="time"
                        value={leg.departureLocalTime}
                        onChange={(event) =>
                          updateLeg(setLegs, leg.id, { departureLocalTime: event.target.value })
                        }
                      />
                      <span className="leg-duration">
                        +{formatDuration(planning.forecast.plannedBlockMinutes)} flight ·{" "}
                        {formatDuration(planning.forecast.minimumTurnaroundMinutes)} turn
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove leg ${index + 1}`}
                        onClick={() =>
                          setLegs((current) => current.filter(({ id }) => id !== leg.id))
                        }
                      >
                        <Trash aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="validation-note">
                  Client times are composition hints. The backend remains authoritative for UTC
                  conversion, DST, curfew, congestion, position, overlap, runway, range, and
                  maintenance occupancy.
                </p>
                <Button
                  className="button-primary"
                  type="submit"
                  disabled={isPending || legs.length === 0}
                >
                  Validate and activate prospectively
                </Button>
              </div>
              <div className="mobile-editor-handoff">
                <strong>Rotation editing requires desktop</strong>
                <p>
                  Monitor the active version below, then continue this draft on a laptop or desktop
                  to avoid unsafe compressed scheduling.
                </p>
              </div>
              {planning.timetable ? <TimetableSummary planning={planning} /> : null}
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function ResearchResult({
  research,
  currency,
  onCreate,
  canCreate,
}: {
  research: ResearchDirectRouteResponse;
  currency: string;
  onCreate(): void;
  canCreate: boolean;
}) {
  return (
    <div className="research-result">
      <div className="research-verdict" data-valid={research.valid}>
        {research.valid ? <CheckCircle aria-hidden /> : <Warning aria-hidden />}
        <div>
          <strong>
            {research.valid ? "Operable direct route" : "Constraints require recovery"}
          </strong>
          <small>Effective {formatDateTime(research.forecast.economicsEffectiveAt)}</small>
        </div>
      </div>
      <dl className="metric-ledger">
        <div>
          <dt>Distance</dt>
          <dd>{research.forecast.distanceNm.toLocaleString()} nm</dd>
        </div>
        <div>
          <dt>Block / turn</dt>
          <dd>
            {formatDuration(research.forecast.plannedBlockMinutes)} /{" "}
            {formatDuration(research.forecast.minimumTurnaroundMinutes)}
          </dd>
        </div>
        <div>
          <dt>Daily demand</dt>
          <dd>
            {Number(research.forecast.provisionalDailyDemand).toLocaleString(undefined, {
              maximumFractionDigits: 1,
            })}{" "}
            pax
          </dd>
        </div>
        <div>
          <dt>Competition</dt>
          <dd>
            {research.market.competition.frequencyPerWeek}/wk ·{" "}
            {formatPercent(research.market.competition.farePressureBasisPoints)} fare pressure
          </dd>
        </div>
        <div>
          <dt>Operating cost</dt>
          <dd>{formatMoney(research.forecast.provisionalOperatingCostMinor, currency)}</dd>
        </div>
        <div>
          <dt>Expected revenue</dt>
          <dd>
            {formatMoney(research.forecast.expectedDailyRevenueRangeMinor[0]!, currency)}–
            {formatMoney(research.forecast.expectedDailyRevenueRangeMinor[1]!, currency)}
          </dd>
        </div>
        <div className="metric-primary">
          <dt>Expected profit</dt>
          <dd>
            {formatMoney(research.forecast.expectedDailyProfitRangeMinor[0]!, currency)}–
            {formatMoney(research.forecast.expectedDailyProfitRangeMinor[1]!, currency)}
          </dd>
        </div>
      </dl>
      <div className="provenance-row">
        <ProvenanceLabel classification="sourced" />
        <ProvenanceLabel classification="derived" />
        <ProvenanceLabel classification="balance" />
      </div>
      {research.market.forecast.segments.length ? (
        <OperationalTable label="Demand segment forecast">
          <thead>
            <tr>
              <th>Segment</th>
              <th>Daily range input</th>
              <th>Primary sensitivity</th>
            </tr>
          </thead>
          <tbody>
            {research.market.forecast.segments.map((segment) => (
              <tr key={segment.segment}>
                <th scope="row">{segment.segment.toUpperCase()}</th>
                <td>{segment.dailyDemand} passengers</td>
                <td>{segment.sensitivity.explanation}</td>
              </tr>
            ))}
          </tbody>
        </OperationalTable>
      ) : null}
      {research.issues.length ? (
        <div className="constraint-list" aria-label="Route constraints">
          {research.issues.map((issue) => (
            <article key={`${issue.code}-${issue.field ?? "route"}`}>
              <Warning aria-hidden />
              <div>
                <strong>{issue.code.replaceAll("_", " ")}</strong>
                <p>{issue.message}</p>
                <a href={recoveryHref(issue.code)}>{issue.suggestedCorrection}</a>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      <details>
        <summary>Economics assumptions and provenance</summary>
        <ul>
          {research.forecast.economicsAssumptions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p>{research.market.competition.explanation}</p>
      </details>
      <Button className="button-primary" type="button" onClick={onCreate} disabled={!canCreate}>
        Save researched route
      </Button>
    </div>
  );
}

function RouteSummary({ planning }: { planning: GetRoutePlanningResponse }) {
  return (
    <div className="route-summary-strip">
      <span>AM{planning.route.routeNumber}</span>
      <strong>
        {planning.route.origin.iataCode} → {planning.route.destination.iataCode}
      </strong>
      <small>
        {planning.route.distanceNm.toLocaleString()} nm · {planning.route.status}
      </small>
      <ProvenanceLabel classification="derived" />
    </div>
  );
}

function TimetableSummary({ planning }: { planning: GetRoutePlanningResponse }) {
  const timetable = planning.timetable;
  if (!timetable) return null;
  return (
    <section className="timetable-summary" aria-labelledby="active-timetable-title">
      <header>
        <h3 id="active-timetable-title">Active version {timetable.version}</h3>
        <span>
          {formatDate(timetable.effectiveFrom)} → {formatDate(timetable.generatedThrough)}
        </span>
      </header>
      <OperationalTable label="Generated dated-flight horizon">
        <thead>
          <tr>
            <th>Flight</th>
            <th>Local schedule</th>
            <th>UTC</th>
            <th>Turnaround ready</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {timetable.flights.slice(0, 14).map((flight) => (
            <tr key={flight.id}>
              <th scope="row">
                {flight.flightNumber}
                <small>
                  {flight.originIataCode}–{flight.destinationIataCode}
                </small>
              </th>
              <td>
                {flight.departureLocal.replace("T", " ")}
                <br />
                {flight.arrivalLocal.replace("T", " ")}
              </td>
              <td>{formatDateTime(flight.departureAt, "UTC")}</td>
              <td>{formatDateTime(flight.readyAt, "UTC")}</td>
              <td>
                <span className="status-chip" data-status={flight.status}>
                  {flight.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </OperationalTable>
    </section>
  );
}

function WeatherSummary({ weather }: { weather: GetRouteWeatherForecastResponse }) {
  const plan = weather.plan as unknown as RouteWeatherPlan;
  return (
    <div className="weather-summary">
      <div className="provenance-row">
        <ProvenanceLabel classification="derived" />
        <span>Issued {formatDateTime(weather.issuedAt)}</span>
      </div>
      <dl>
        <div>
          <dt>Valid</dt>
          <dd>{formatDateTime(weather.validAt)}</dd>
        </div>
        <div>
          <dt>Uncertainty</dt>
          <dd>{formatPercent(plan.uncertaintyBasisPoints)}</dd>
        </div>
        <div>
          <dt>Block modifier</dt>
          <dd>
            {formatPercent(plan.expectedBlockTimeBasisPoints)} · range{" "}
            {formatPercent(plan.bounds.blockTimeBasisPoints[0])}–
            {formatPercent(plan.bounds.blockTimeBasisPoints[1])}
          </dd>
        </div>
        <div>
          <dt>Fuel modifier</dt>
          <dd>
            {formatPercent(plan.expectedFuelBurnBasisPoints)} · range{" "}
            {formatPercent(plan.bounds.fuelBurnBasisPoints[0])}–
            {formatPercent(plan.bounds.fuelBurnBasisPoints[1])}
          </dd>
        </div>
        <div>
          <dt>Runway capacity</dt>
          <dd>{formatPercent(plan.runwayCapacityBasisPoints)}</dd>
        </div>
        <div>
          <dt>Delay / diversion risk</dt>
          <dd>
            {formatPercent(plan.congestionDelayRiskBasisPoints)} /{" "}
            {formatPercent(plan.diversionRiskBasisPoints)}
          </dd>
        </div>
        <div>
          <dt>Reliability</dt>
          <dd>{formatPercent(plan.reliabilityBasisPoints)}</dd>
        </div>
      </dl>
      <OperationalTable label="Airport weather planning inputs">
        <thead>
          <tr>
            <th>Airport</th>
            <th>Wind</th>
            <th>Visibility</th>
            <th>Uncertainty</th>
          </tr>
        </thead>
        <tbody>
          {[plan.origin, plan.destination].map((snapshot) => (
            <tr key={snapshot.airportId}>
              <th scope="row">{snapshot.iataCode}</th>
              <td>
                {snapshot.conditions.windDirectionDeg}° at {snapshot.conditions.windSpeedKt} kt
              </td>
              <td>{snapshot.conditions.visibilityMeters.toLocaleString()} m</td>
              <td>
                ±{snapshot.uncertainty.windSpreadKt} kt · ±
                {snapshot.uncertainty.visibilitySpreadMeters.toLocaleString()} m
              </td>
            </tr>
          ))}
        </tbody>
      </OperationalTable>
      <details>
        <summary>Weather model explanation and provenance</summary>
        <ul>
          {plan.explanations.map((explanation) => (
            <li key={explanation}>{explanation}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function MoneyField({
  label,
  id,
  value,
  onChange,
  advanced = false,
}: {
  label: string;
  id: string;
  value: string;
  onChange(value: string): void;
  advanced?: boolean;
}) {
  return (
    <div className={advanced ? "advanced-pricing-control" : ""}>
      <Field label={label} htmlFor={id}>
        <input
          id={id}
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
        />
      </Field>
    </div>
  );
}

function defaultLegs(origin?: string, destination?: string): LegDraft[] {
  if (!origin || !destination) return [];
  return [
    {
      id: "outbound",
      dayOfWeek: 1,
      originIataCode: origin,
      destinationIataCode: destination,
      departureLocalTime: "08:00",
    },
    {
      id: "return",
      dayOfWeek: 1,
      originIataCode: destination,
      destinationIataCode: origin,
      departureLocalTime: "14:00",
    },
  ];
}

function updateLeg(
  setLegs: Dispatch<SetStateAction<LegDraft[]>>,
  id: string,
  patch: Partial<LegDraft>,
) {
  setLegs((current) => current.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)));
}

function messageFor(cause: unknown) {
  if (cause instanceof WebApiError) {
    const details = cause.actionable.details.map(({ issue }) => issue);
    return details.length
      ? `${cause.actionable.message} ${details.join(" ")}`
      : cause.actionable.message;
  }
  return "The planning service could not complete the request. Your entered values remain available.";
}

function recoveryHref(code: string) {
  if (code.includes("aircraft") || code.includes("range") || code.includes("runway"))
    return "/app?view=fleet";
  if (code.includes("maintenance")) return "/app?view=maintenance";
  if (code.includes("workforce")) return "/app?view=workforce";
  return "/app?view=network";
}
