"use client";

import type {
  GetFleetAircraftPlanningDetailResponse,
  ListAircraftMaintenanceHistoryResponse,
} from "@airline-manager/contracts";
import { CalendarPlus, Gauge, ShieldCheck, Warning, Wrench } from "@phosphor-icons/react";
import { useState, useTransition, type FormEvent } from "react";
import { WebApiError, createStableIdempotencyKey } from "../lib/client-api";
import { formatDateTime, formatDuration, formatMoney, formatPercent } from "../lib/planning-format";
import {
  planningApi,
  type PlanningMaintenanceForecast,
  type PlanningMaintenanceProgram,
} from "../lib/planning-api";
import { Button, Field, OperationalTable, ProvenanceLabel, StateMessage } from "./ui";

export function MaintenanceWorkspace({
  airlineId,
  fleetDetail,
  initialProgram,
  initialForecast,
  history,
}: {
  airlineId: string;
  fleetDetail: GetFleetAircraftPlanningDetailResponse;
  initialProgram: PlanningMaintenanceProgram;
  initialForecast: PlanningMaintenanceForecast;
  history: ListAircraftMaintenanceHistoryResponse;
}) {
  const aircraft = fleetDetail.aircraft;
  const [forecast, setForecast] = useState(initialForecast);
  const [ruleCode, setRuleCode] = useState(initialProgram.rules[0]?.code ?? "");
  const [startsAt, setStartsAt] = useState(() =>
    new Date(Date.now() + 48 * 3_600_000).toISOString().slice(0, 16),
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function schedule(event: FormEvent) {
    event.preventDefault();
    const input = { ruleCode, startsAt: new Date(startsAt).toISOString() };
    const key = createStableIdempotencyKey(
      `ticket20:maintenance:${aircraft.id}`,
      JSON.stringify(input),
    );
    setError(null);
    startTransition(async () => {
      try {
        const result = await planningApi.scheduleMaintenance(airlineId, aircraft.id, input, key);
        const refreshed = await planningApi.maintenanceForecast(airlineId, aircraft.id);
        setForecast(refreshed as unknown as PlanningMaintenanceForecast);
        setConfirmation(
          `Maintenance window reserved ${formatDateTime(result.startsAt)}–${formatDateTime(result.endsAt)}.`,
        );
      } catch (cause) {
        setError(messageFor(cause));
      }
    });
  }

  return (
    <div className="focused-workspace maintenance-workspace">
      <header className="workspace-titlebar">
        <div>
          <p className="context-label">Aircraft maintenance program</p>
          <h2>
            {aircraft.manufacturer} {aircraft.model} readiness
          </h2>
          <p>
            {aircraft.serialNumber} · utilization, condition, faults, workforce, and rotation
            occupancy share one constraint surface.
          </p>
        </div>
        <div className="workspace-count">
          <Wrench aria-hidden />
          <strong>{forecast.dispatchReady ? "Ready" : "Blocked"}</strong>
          <span>dispatch state</span>
        </div>
      </header>

      {error ? (
        <StateMessage tone="critical" title="Maintenance window blocked">
          {error} <a href="/app?view=network">Review aircraft rotation occupancy</a> or{" "}
          <a href="/app?view=workforce">restore line-maintenance capacity</a>.
        </StateMessage>
      ) : null}
      {confirmation ? (
        <StateMessage tone="nominal" title="Maintenance plan refreshed">
          {confirmation}
        </StateMessage>
      ) : null}

      <div className="maintenance-overview">
        <section aria-labelledby="readiness-title">
          <header>
            <ShieldCheck aria-hidden />
            <h3 id="readiness-title">Dispatch readiness</h3>
            <ProvenanceLabel classification="derived" />
          </header>
          <dl className="metric-ledger">
            <div className="metric-primary">
              <dt>Status</dt>
              <dd>{forecast.dispatchReady ? "Dispatch ready" : "Dispatch blocked"}</dd>
            </div>
            <div>
              <dt>Condition</dt>
              <dd>{formatPercent(forecast.conditionBasisPoints)}</dd>
            </div>
            <div>
              <dt>Reliability</dt>
              <dd>{formatPercent(forecast.dispatchReliabilityBasisPoints)}</dd>
            </div>
            <div>
              <dt>Program</dt>
              <dd>{forecast.programVersion}</dd>
            </div>
            <div>
              <dt>Generated</dt>
              <dd>{formatDateTime(forecast.generatedAt)}</dd>
            </div>
          </dl>
        </section>
        <section aria-labelledby="utilization-title">
          <header>
            <Gauge aria-hidden />
            <h3 id="utilization-title">Utilization counters</h3>
            <ProvenanceLabel classification="sourced" />
          </header>
          <dl className="metric-ledger">
            <div>
              <dt>Hours</dt>
              <dd>{formatDuration(aircraft.accumulatedHoursMinutes)}</dd>
            </div>
            <div>
              <dt>Cycles</dt>
              <dd>{Number(aircraft.accumulatedCycles).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Active faults</dt>
              <dd>{forecast.activeFaults.length}</dd>
            </div>
            <div>
              <dt>Planned windows</dt>
              <dd>{forecast.plannedWork.length}</dd>
            </div>
          </dl>
        </section>
        <form
          className="maintenance-scheduler desktop-planning-action"
          onSubmit={schedule}
          aria-labelledby="schedule-maintenance-title"
        >
          <header>
            <CalendarPlus aria-hidden />
            <div>
              <h3 id="schedule-maintenance-title">Reserve planned work</h3>
              <p>Backend checks rotation occupancy and qualified workforce.</p>
            </div>
          </header>
          <Field label="Maintenance rule" htmlFor="maintenance-rule">
            <select
              id="maintenance-rule"
              value={ruleCode}
              onChange={(event) => setRuleCode(event.target.value)}
            >
              {initialProgram.rules.map((rule) => (
                <option value={rule.code} key={rule.code}>
                  {rule.name} · {formatDuration(rule.durationMinutes)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Window start"
            htmlFor="maintenance-start"
            hint="UTC instant; aircraft location and occupancy are rechecked"
          >
            <input
              id="maintenance-start"
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </Field>
          <Button className="button-primary" type="submit" disabled={isPending}>
            Preview constraints and schedule
          </Button>
          <div className="mobile-editor-handoff">
            <strong>Maintenance scheduling requires desktop</strong>
            <p>Mobile retains readiness, due counters, faults, and planned-window monitoring.</p>
          </div>
        </form>
      </div>

      <section className="maintenance-due" aria-labelledby="due-title">
        <header>
          <div>
            <p className="context-label">Due and hard-limit counters</p>
            <h3 id="due-title">Program requirements</h3>
          </div>
          <ProvenanceLabel classification="balance" />
        </header>
        <OperationalTable label="Aircraft maintenance due counters">
          <thead>
            <tr>
              <th>Rule</th>
              <th>Kind</th>
              <th>Remaining</th>
              <th>Hard limit</th>
              <th>Downtime</th>
              <th>Workforce</th>
              <th>Cost</th>
              <th>State / recovery</th>
            </tr>
          </thead>
          <tbody>
            {initialProgram.rules.map((rule) => {
              const due = forecast.due.find((item) => item.ruleCode === rule.code);
              return (
                <tr key={rule.code}>
                  <th scope="row">
                    {rule.name}
                    <small>{rule.code}</small>
                  </th>
                  <td>{rule.kind}</td>
                  <td>
                    {due?.hoursMinutesRemaining
                      ? `${formatDuration(due.hoursMinutesRemaining)} / `
                      : ""}
                    {due?.cyclesRemaining ? `${due.cyclesRemaining} cycles / ` : ""}
                    {due?.calendarDaysRemaining === undefined
                      ? ""
                      : `${due.calendarDaysRemaining} days`}
                  </td>
                  <td>
                    {rule.hardLimit
                      ? "Hard stop"
                      : `Deferral: ${formatDuration(rule.maximumDeferralHoursMinutes)}, ${rule.maximumDeferralCycles} cycles, ${rule.maximumDeferralCalendarDays} days`}
                  </td>
                  <td>{formatDuration(rule.durationMinutes)}</td>
                  <td>{rule.workforceCapacity} line-maintenance capacity</td>
                  <td>{formatMoney(rule.costMinor, fleetDetail.lease.currency)}</td>
                  <td>
                    <span className="status-chip" data-status={due?.state ?? "unknown"}>
                      {due?.state?.replaceAll("_", " ") ?? "not assessed"}
                    </span>
                    <small>{due?.recoveryStep}</small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </OperationalTable>
      </section>

      <div className="maintenance-detail-columns">
        <section aria-labelledby="planned-windows-title">
          <header>
            <h3 id="planned-windows-title">Planned windows and rotation occupancy</h3>
          </header>
          {forecast.plannedWork.length ? (
            <OperationalTable label="Planned maintenance windows">
              <thead>
                <tr>
                  <th>Window</th>
                  <th>Source</th>
                  <th>Workforce</th>
                  <th>Cost</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {forecast.plannedWork.map((work) => (
                  <tr key={work.id}>
                    <th scope="row">
                      {formatDateTime(work.startsAt)}–{formatDateTime(work.endsAt)}
                    </th>
                    <td>
                      {work.source}
                      {work.ruleCode ? ` · ${work.ruleCode}` : ""}
                    </td>
                    <td>{work.workforceCapacity}</td>
                    <td>{formatMoney(work.costMinor, fleetDetail.lease.currency)}</td>
                    <td>{work.status}</td>
                  </tr>
                ))}
              </tbody>
            </OperationalTable>
          ) : (
            <StateMessage title="No planned maintenance windows">
              Schedule due work before it intersects the active aircraft rotation.
            </StateMessage>
          )}
          {forecast.scheduleConflicts.map((conflict) => (
            <StateMessage key={conflict} tone="warning" title="Rotation conflict">
              {conflict} <a href="/app?view=network">Open timetable recovery</a>.
            </StateMessage>
          ))}
        </section>

        <section aria-labelledby="faults-title">
          <header>
            <h3 id="faults-title">Condition, reliability, and faults</h3>
          </header>
          {forecast.activeFaults.length ? (
            <div className="constraint-list">
              {forecast.activeFaults.map((fault) => (
                <article key={fault.id}>
                  <Warning aria-hidden />
                  <div>
                    <strong>
                      {fault.outcome} · {fault.groundsAircraft ? "grounding" : "dispatch impact"}
                    </strong>
                    <p>{fault.explanation}</p>
                    <span>
                      {formatDuration(fault.repairDurationMinutes)} repair ·{" "}
                      {fault.repairWorkforceCapacity} qualified capacity
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <StateMessage tone="nominal" title="No active faults">
              The deterministic inspection history has no unresolved fault.
            </StateMessage>
          )}
          {forecast.explanations.map((explanation) => (
            <p key={explanation}>{explanation}</p>
          ))}
        </section>
      </div>

      <section className="maintenance-history" aria-labelledby="history-title">
        <header>
          <h3 id="history-title">Immutable maintenance history</h3>
        </header>
        <OperationalTable label="Aircraft maintenance history">
          <thead>
            <tr>
              <th>Sequence</th>
              <th>Occurred</th>
              <th>Event</th>
              <th>Recorded detail</th>
            </tr>
          </thead>
          <tbody>
            {history.slice(0, 20).map((raw, index) => {
              const event = raw as {
                id?: string;
                sequence?: string;
                occurredAt?: string;
                eventType?: string;
                details?: Record<string, unknown>;
              };
              return (
                <tr key={event.id ?? index}>
                  <th scope="row">{event.sequence ?? index + 1}</th>
                  <td>{event.occurredAt ? formatDateTime(event.occurredAt) : "—"}</td>
                  <td>{event.eventType ?? "recorded event"}</td>
                  <td>{JSON.stringify(event.details ?? {})}</td>
                </tr>
              );
            })}
          </tbody>
        </OperationalTable>
      </section>
    </div>
  );
}

function messageFor(cause: unknown) {
  if (cause instanceof WebApiError) {
    const detail = cause.actionable.details.map(({ issue }) => issue).join(" ");
    return `${cause.actionable.message}${detail ? ` ${detail}` : ""}`;
  }
  return "The maintenance service could not schedule this window. Entered values remain available.";
}
