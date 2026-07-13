import type {
  GetAircraftMaintenanceForecastResponse,
  GetFleetAircraftPlanningDetailResponse,
} from "@airline-manager/contracts";
import { Airplane, CalendarCheck, Gauge, MapPin, Wrench } from "@phosphor-icons/react/dist/ssr";
import type { AirportMapAirport } from "../map/airport-map";
import { formatDateTime, formatDuration, formatMoney, formatPercent } from "../lib/planning-format";
import { OperationalTable, ProvenanceLabel, StateMessage } from "./ui";

export function FleetWorkspace({
  details,
  maintenance,
  airports,
}: {
  details: readonly GetFleetAircraftPlanningDetailResponse[];
  maintenance: readonly GetAircraftMaintenanceForecastResponse[];
  airports: readonly AirportMapAirport[];
}) {
  return (
    <div className="focused-workspace fleet-workspace">
      <header className="workspace-titlebar">
        <div>
          <p className="context-label">Owner-scoped fleet</p>
          <h2>Aircraft obligations and readiness</h2>
          <p>
            Lease, utilization, condition, and maintenance state come from the authoritative fleet
            record.
          </p>
        </div>
        <div className="workspace-count">
          <Airplane aria-hidden />
          <strong>{details.length}</strong>
          <span>aircraft</span>
        </div>
      </header>

      {details.length === 0 ? (
        <StateMessage tone="warning" title="No aircraft available">
          Return to onboarding to accept the founder lease before researching routes.
        </StateMessage>
      ) : (
        details.map((detail) => {
          const aircraft = detail.aircraft;
          const forecast = maintenance.find((item) => item.aircraftId === aircraft.id);
          const currentAirportId =
            typeof aircraft.currentAirportId === "string" ? aircraft.currentAirportId : null;
          const plannedAirportId =
            typeof aircraft.plannedAirportId === "string" ? aircraft.plannedAirportId : null;
          const current = airports.find(({ id }) => id === currentAirportId);
          const planned = airports.find(({ id }) => id === plannedAirportId);
          const available =
            aircraft.deliveryState === "delivered" && forecast?.dispatchReady === true;
          const statusLabel =
            aircraft.deliveryState === "pending"
              ? "Delivery pending"
              : available
                ? "Available"
                : "Planning constraint";
          return (
            <article className="aircraft-dossier" key={aircraft.id}>
              <header className="aircraft-heading">
                <div className="aircraft-identity">
                  <span>
                    <Airplane aria-hidden />
                  </span>
                  <div>
                    <p>{aircraft.variantCode}</p>
                    <h3>
                      {aircraft.manufacturer} {aircraft.model}
                    </h3>
                    <small>{aircraft.serialNumber}</small>
                  </div>
                </div>
                <span className="status-chip" data-status={available ? "ready" : "warning"}>
                  {statusLabel}
                </span>
              </header>

              <div className="aircraft-metrics">
                <section aria-labelledby={`${aircraft.id}-position`}>
                  <header>
                    <MapPin aria-hidden />
                    <h4 id={`${aircraft.id}-position`}>Position and delivery</h4>
                  </header>
                  <dl>
                    <div>
                      <dt>Current</dt>
                      <dd>
                        {current
                          ? `${current.iataCode} · ${current.name}`
                          : (currentAirportId ?? "In delivery")}
                      </dd>
                    </div>
                    <div>
                      <dt>Planned</dt>
                      <dd>
                        {planned
                          ? `${planned.iataCode} · ${planned.name}`
                          : (plannedAirportId ?? "Not assigned")}
                      </dd>
                    </div>
                    <div>
                      <dt>Delivery state</dt>
                      <dd>{aircraft.deliveryState}</dd>
                    </div>
                    <div>
                      <dt>Target</dt>
                      <dd>{formatDateTime(aircraft.deliveryTargetAt)}</dd>
                    </div>
                  </dl>
                  <ProvenanceLabel classification="sourced" />
                </section>

                <section aria-labelledby={`${aircraft.id}-utilization`}>
                  <header>
                    <Gauge aria-hidden />
                    <h4 id={`${aircraft.id}-utilization`}>Condition and utilization</h4>
                  </header>
                  <dl>
                    <div>
                      <dt>Condition</dt>
                      <dd>{formatPercent(aircraft.conditionBasisPoints)}</dd>
                    </div>
                    <div>
                      <dt>Dispatch reliability</dt>
                      <dd>{formatPercent(aircraft.dispatchReliabilityBasisPoints)}</dd>
                    </div>
                    <div>
                      <dt>Flight hours</dt>
                      <dd>{formatDuration(aircraft.accumulatedHoursMinutes)}</dd>
                    </div>
                    <div>
                      <dt>Cycles</dt>
                      <dd>{Number(aircraft.accumulatedCycles).toLocaleString()}</dd>
                    </div>
                  </dl>
                  <ProvenanceLabel classification="derived" />
                </section>

                <section aria-labelledby={`${aircraft.id}-lease`}>
                  <header>
                    <CalendarCheck aria-hidden />
                    <h4 id={`${aircraft.id}-lease`}>Founder lease</h4>
                  </header>
                  <dl>
                    <div>
                      <dt>Owner</dt>
                      <dd>{aircraft.owner.name}</dd>
                    </div>
                    <div>
                      <dt>Obligation</dt>
                      <dd>
                        {formatMoney(detail.lease.recurringPaymentMinor, detail.lease.currency)}{" "}
                        every {detail.lease.paymentIntervalDays} days
                      </dd>
                    </div>
                    <div>
                      <dt>Term</dt>
                      <dd>
                        {detail.lease.termDays} days · matures{" "}
                        {formatDateTime(detail.lease.maturesAt)}
                      </dd>
                    </div>
                    <div>
                      <dt>Restrictions</dt>
                      <dd>Sale, collateral, and cash extraction prohibited</dd>
                    </div>
                  </dl>
                  <ProvenanceLabel classification="balance" />
                </section>

                <section aria-labelledby={`${aircraft.id}-maintenance`}>
                  <header>
                    <Wrench aria-hidden />
                    <h4 id={`${aircraft.id}-maintenance`}>Maintenance readiness</h4>
                  </header>
                  <dl>
                    <div>
                      <dt>Dispatch</dt>
                      <dd>
                        {aircraft.deliveryState === "pending"
                          ? "Awaiting delivery"
                          : forecast?.dispatchReady
                            ? "Ready"
                            : "Blocked"}
                      </dd>
                    </div>
                    <div>
                      <dt>Due work</dt>
                      <dd>
                        {forecast?.due.filter(
                          (item) => (item as { state?: string }).state !== "not_due",
                        ).length ?? "Not available"}
                      </dd>
                    </div>
                    <div>
                      <dt>Planned windows</dt>
                      <dd>{forecast?.plannedWork.length ?? "Not available"}</dd>
                    </div>
                    <div>
                      <dt>Active faults</dt>
                      <dd>{forecast?.activeFaults.length ?? "Not available"}</dd>
                    </div>
                  </dl>
                  <ProvenanceLabel classification="derived" />
                </section>
              </div>

              <nav
                className="recovery-link-row"
                aria-label={`Planning links for ${aircraft.serialNumber}`}
              >
                <a href={`/app?view=network&aircraft=${aircraft.id}`}>Research a route</a>
                <a href="/app?view=workforce">Check type-rating capacity</a>
                <a href={`/app?view=maintenance&aircraft=${aircraft.id}`}>Plan maintenance</a>
                <a href="/app?view=fuel">Review fuel forecast</a>
              </nav>

              <section className="lease-schedule" aria-labelledby={`${aircraft.id}-lease-schedule`}>
                <h4 id={`${aircraft.id}-lease-schedule`}>Lease payment schedule</h4>
                <OperationalTable label={`Lease payment schedule for ${aircraft.serialNumber}`}>
                  <thead>
                    <tr>
                      <th>Payment</th>
                      <th>Due</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lease.paymentSchedule.map((payment) => (
                      <tr key={payment.paymentNumber}>
                        <th scope="row">#{payment.paymentNumber}</th>
                        <td>{formatDateTime(payment.dueAt)}</td>
                        <td>{formatMoney(payment.amountMinor, detail.lease.currency)}</td>
                        <td>
                          <span className="status-chip" data-status={payment.status}>
                            {payment.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </OperationalTable>
              </section>
            </article>
          );
        })
      )}
    </div>
  );
}
