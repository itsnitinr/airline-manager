"use client";

import type {
  FlightBoard,
  FlightBoardItem,
  FlightStatus,
  OfflineFlightChanges,
  SettledFlightSnapshot,
} from "@airline-manager/domain";
import dynamic from "next/dynamic";
import { startTransition, useMemo, useState } from "react";
import { AirportMap } from "../map/airport-map";
import { formatDateTime, formatDuration } from "../lib/planning-format";
import { monitoringApi } from "../lib/ticket21-api";
import { LiveAuthorityStatus } from "./live-authority-status";

const FlightDetail = dynamic(
  () => import("./flight-detail").then(({ FlightDetail }) => FlightDetail),
  {
    loading: () => <p className="empty-inline">Loading authoritative flight detail.</p>,
  },
);

const stateOptions = [
  "all",
  "scheduled",
  "delayed",
  "suspended",
  "cancelled",
  "boarding",
  "departed",
  "diverted",
  "arrived",
  "settled",
] as const;

export function OperationsWorkspace({
  board,
  changes,
  airlineId,
  reportingCurrency,
  initialFlightId,
}: {
  board: FlightBoard;
  changes: OfflineFlightChanges;
  airlineId: string;
  reportingCurrency: string;
  initialFlightId?: string;
}) {
  const [state, setState] = useState<(typeof stateOptions)[number]>("all");
  const [route, setRoute] = useState("all");
  const [aircraft, setAircraft] = useState("all");
  const [selectedId, setSelectedId] = useState(initialFlightId ?? board.items[0]?.id ?? null);
  const [status, setStatus] = useState<FlightStatus | null>(null);
  const [settlement, setSettlement] = useState<SettledFlightSnapshot | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [detailPending, setDetailPending] = useState(false);

  const filtered = useMemo(
    () =>
      board.items.filter(
        (flight) =>
          (state === "all" || flight.state === state) &&
          (route === "all" || flight.routeId === route) &&
          (aircraft === "all" || flight.aircraftId === aircraft),
      ),
    [aircraft, board.items, route, state],
  );
  const selected = board.items.find(({ id }) => id === selectedId) ?? filtered[0] ?? null;
  const airports = useMemo(() => {
    const values = new Map<string, FlightBoardItem["origin"]>();
    for (const flight of board.items) {
      values.set(flight.origin.id, flight.origin);
      values.set(flight.destination.id, flight.destination);
    }
    return [...values.values()].map((airport) => ({
      id: airport.id,
      iataCode: airport.iataCode,
      name: airport.name,
      latitudeDeg: airport.latitudeDeg,
      longitudeDeg: airport.longitudeDeg,
    }));
  }, [board.items]);
  const routes = useMemo(
    () => [...new Map(board.items.map((item) => [item.routeId, item])).values()],
    [board.items],
  );
  const aircraftOptions = useMemo(
    () => [...new Map(board.items.map((item) => [item.aircraftId, item.aircraft])).entries()],
    [board.items],
  );

  const openFlight = (flight: FlightBoardItem) => {
    setSelectedId(flight.id);
    setStatus(null);
    setSettlement(null);
    setDetailError(false);
    setDetailPending(true);
    startTransition(() => {
      void Promise.all([
        monitoringApi.flightStatus(airlineId, flight.id),
        flight.state === "settled"
          ? monitoringApi.flightSettlement(airlineId, flight.id)
          : Promise.resolve(null),
      ])
        .then(([nextStatus, nextSettlement]) => {
          setStatus(nextStatus);
          setSettlement(nextSettlement);
        })
        .catch(() => setDetailError(true))
        .finally(() => setDetailPending(false));
    });
  };

  return (
    <section className="operations-desk">
      <div className="operations-map" aria-label="Operational geography">
        <AirportMap
          airports={airports}
          selectedAirportIds={selected ? [selected.origin.id, selected.destination.id] : []}
          {...(selected
            ? {
                route: {
                  originAirportId: selected.origin.id,
                  destinationAirportId: selected.destination.id,
                },
              }
            : {})}
          interactive
          presentation="shell"
          label="Current and upcoming flight geography"
        />
      </div>
      <section className="operations-board" aria-label="Chronological flight board">
        <header className="operations-toolbar">
          <div>
            <p className="eyebrow">Owner-scoped operational timeline</p>
            <h2>Flight board</h2>
            <small>
              {formatDateTime(board.from)} to {formatDateTime(board.to)} · as of{" "}
              {formatDateTime(board.asOf)}
            </small>
          </div>
          <LiveAuthorityStatus />
        </header>
        {changes.total > 0 ? (
          <section className="change-summary" aria-label="Changes while away">
            <strong>{changes.total} changes since your last monitoring window</strong>
            <p>
              {Object.entries(changes.byState)
                .map(([nextState, count]) => `${count} ${nextState}`)
                .join(" · ")}
            </p>
            <details>
              <summary>Review what changed</summary>
              <ol>
                {changes.items.map((change) => (
                  <li key={`${change.flightId}-${change.effectiveAt}`}>
                    <strong>{change.flightNumber}</strong> {change.toState} · {change.explanation}
                  </li>
                ))}
              </ol>
            </details>
          </section>
        ) : null}
        <div className="operations-filters" aria-label="Flight board filters">
          <label>
            State
            <select
              value={state}
              onChange={(event) =>
                startTransition(() => setState(event.target.value as typeof state))
              }
            >
              {stateOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All states" : option}
                </option>
              ))}
            </select>
          </label>
          <label>
            Route
            <select
              value={route}
              onChange={(event) => startTransition(() => setRoute(event.target.value))}
            >
              <option value="all">All routes</option>
              {routes.map((item) => (
                <option key={item.routeId} value={item.routeId}>
                  {item.origin.iataCode} to {item.destination.iataCode}
                </option>
              ))}
            </select>
          </label>
          <label>
            Aircraft
            <select
              value={aircraft}
              onChange={(event) => startTransition(() => setAircraft(event.target.value))}
            >
              <option value="all">All aircraft</option>
              {aircraftOptions.map(([id, item]) => (
                <option key={id} value={id}>
                  {item.serialNumber} · {item.variant}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flight-board-scroll">
          <table>
            <caption className="sr-only">Accessible equivalent of the operational map</caption>
            <thead>
              <tr>
                <th scope="col">Flight</th>
                <th scope="col">Route and time</th>
                <th scope="col">Aircraft</th>
                <th scope="col">State</th>
                <th scope="col">Context</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((flight) => (
                <tr key={flight.id} data-selected={selected?.id === flight.id}>
                  <th scope="row">
                    <button type="button" onClick={() => openFlight(flight)}>
                      {flight.flightNumber}
                    </button>
                  </th>
                  <td>
                    <strong>
                      {flight.origin.iataCode} → {flight.destination.iataCode}
                    </strong>
                    <small>{formatDateTime(flight.departureAt, flight.origin.timeZone)}</small>
                    <small>{formatDateTime(flight.departureAt)} UTC</small>
                  </td>
                  <td>
                    {flight.aircraft.serialNumber}
                    <small>{flight.aircraft.variant}</small>
                  </td>
                  <td>
                    <span className="state-label" data-state={flight.state}>
                      {flight.state}
                    </span>
                    <small>Effective {formatDateTime(flight.effectiveAt)}</small>
                  </td>
                  <td>
                    {flight.delayMinutes > 0 ? (
                      <strong>{formatDuration(flight.delayMinutes)} delay</strong>
                    ) : (
                      "On plan"
                    )}
                    <small>{flight.passengersBooked} booked</small>
                    {flight.alerts.map((alert) => (
                      <a key={alert.kind} href={alert.recoveryPath} className="recovery-link">
                        {alert.label}: {alert.explanation}
                      </a>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <p className="empty-inline">No flights match these filters.</p>
          ) : null}
        </div>
      </section>
      {selected ? (
        <aside className="flight-inspector" aria-label="Selected flight detail">
          {!status && !detailPending && !detailError ? (
            <button
              className="button button-primary"
              type="button"
              onClick={() => openFlight(selected)}
            >
              Open {selected.flightNumber} detail
            </button>
          ) : null}
          {detailPending ? <p role="status">Refreshing authoritative flight detail.</p> : null}
          {detailError ? (
            <div className="state-message" data-tone="danger" role="alert">
              <strong>Flight detail is temporarily unavailable</strong>
              <button
                className="button button-quiet"
                type="button"
                onClick={() => openFlight(selected)}
              >
                Retry
              </button>
            </div>
          ) : null}
          {status ? (
            <FlightDetail status={status} settlement={settlement} currency={reportingCurrency} />
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}
