"use client";

import type { FlightStatus, SettledFlightSnapshot } from "@airline-manager/domain";
import { formatDateTime, formatDuration, formatMass, formatMoney } from "../lib/planning-format";

const label = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());

export function FlightDetail({
  status,
  settlement,
  currency,
}: {
  status: FlightStatus;
  settlement: SettledFlightSnapshot | null;
  currency: string;
}) {
  return (
    <section className="flight-detail" aria-label={`${status.flightNumber} detail`}>
      <header>
        <div>
          <p className="eyebrow">Authoritative flight record</p>
          <h2>{status.flightNumber}</h2>
        </div>
        <span className="state-label" data-state={status.state}>
          {label(status.state)}
        </span>
      </header>
      <dl className="detail-facts">
        <div>
          <dt>Departure</dt>
          <dd>{formatDateTime(status.departureAt)}</dd>
        </div>
        <div>
          <dt>Scheduled arrival</dt>
          <dd>{formatDateTime(status.scheduledArrivalAt)}</dd>
        </div>
        <div>
          <dt>State effective</dt>
          <dd>{formatDateTime(status.effectiveAt)}</dd>
        </div>
        <div>
          <dt>Record version</dt>
          <dd>{status.version}</dd>
        </div>
      </dl>
      {status.suspension ? (
        <section className="operational-callout" data-severity="critical">
          <h3>Suspended: {label(status.suspension.reasonCode)}</h3>
          <p>{status.suspension.explanation}</p>
          <ul>
            {status.suspension.recoverySteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h3>State timeline</h3>
        <ol className="state-timeline">
          {status.timeline.map((entry) => (
            <li key={entry.sequence}>
              <span aria-hidden />
              <div>
                <strong>{label(entry.toState)}</strong>
                <p>{entry.explanation}</p>
                <small>
                  {formatDateTime(entry.effectiveAt)} · {label(entry.milestone)}
                </small>
              </div>
            </li>
          ))}
        </ol>
      </section>
      {settlement ? (
        <>
          <section>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Immutable settled snapshot</p>
                <h3>Realized operation</h3>
              </div>
              <small>Settled {formatDateTime(settlement.settledAt)}</small>
            </div>
            <dl className="settlement-ledger">
              <div>
                <dt>Passengers carried</dt>
                <dd>{settlement.outcome.passengersCarried}</dd>
              </div>
              <div>
                <dt>Block time</dt>
                <dd>{formatDuration(settlement.outcome.realizedBlockMinutes)}</dd>
              </div>
              <div>
                <dt>Delay</dt>
                <dd>{formatDuration(settlement.outcome.delayMinutes)}</dd>
              </div>
              <div>
                <dt>Fuel burn</dt>
                <dd>{formatMass(settlement.outcome.fuelBurnKg)}</dd>
              </div>
              <div>
                <dt>Passenger revenue</dt>
                <dd>{formatMoney(settlement.outcome.passengerRevenueMinor, currency)}</dd>
              </div>
              <div>
                <dt>Refunds</dt>
                <dd>{formatMoney(settlement.outcome.refundMinor, currency)}</dd>
              </div>
              <div>
                <dt>Fuel cost</dt>
                <dd>{formatMoney(settlement.outcome.fuelCostMinor, currency)}</dd>
              </div>
              <div>
                <dt>Wages</dt>
                <dd>{formatMoney(settlement.outcome.wageAllocationMinor, currency)}</dd>
              </div>
              <div>
                <dt>Maintenance</dt>
                <dd>{formatMoney(settlement.outcome.maintenanceAllocationMinor, currency)}</dd>
              </div>
              <div>
                <dt>Airport and handling</dt>
                <dd>{formatMoney(settlement.outcome.airportCostMinor, currency)}</dd>
              </div>
              <div className="settlement-result">
                <dt>Operating result</dt>
                <dd>{formatMoney(settlement.outcome.operatingResultMinor, currency)}</dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>Frozen inputs and versions</h3>
            <div className="snapshot-stages">
              {Object.keys(settlement.materialInputs).map((stage) => (
                <div key={stage}>
                  <strong>{label(stage)}</strong>
                  <span>
                    Captured input set retained in snapshot schema {settlement.schemaVersion}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h3>Reconciliation references</h3>
            <div className="reconciliation-list">
              {Object.entries(settlement.reconciliation).map(([kind, reference]) => (
                <div key={kind}>
                  <span>{label(kind)}</span>
                  <code>{reference}</code>
                </div>
              ))}
              <div>
                <span>Posted journals</span>
                <code>{settlement.journalEntryIds.length} immutable entries</code>
              </div>
              <div>
                <span>Content hash</span>
                <code>{settlement.contentHash.slice(0, 16)}…</code>
              </div>
            </div>
          </section>
        </>
      ) : (
        <p className="empty-inline">Settlement is available only after the lifecycle settles.</p>
      )}
    </section>
  );
}
