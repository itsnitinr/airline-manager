"use client";

import type {
  ForecastWorkforceResponse,
  GetWorkforceRecommendationsResponse,
  ListFleetResponse,
} from "@airline-manager/contracts";
import type { WorkforceStarterPackage } from "@airline-manager/domain";
import { Clock, GraduationCap, UsersThree, Warning } from "@phosphor-icons/react";
import { useState, useTransition, type FormEvent } from "react";
import { WebApiError, createStableIdempotencyKey } from "../lib/client-api";
import { formatDateTime, formatMoney } from "../lib/planning-format";
import { asWorkforcePools, planningApi, type PlanningWorkforcePool } from "../lib/planning-api";
import { Button, Field, OperationalTable, ProvenanceLabel, StateMessage } from "./ui";

export function WorkforceWorkspace({
  airlineId,
  initialPools,
  recommendations,
  initialForecast,
  fleet,
}: {
  airlineId: string;
  initialPools: PlanningWorkforcePool[];
  recommendations: GetWorkforceRecommendationsResponse;
  initialForecast: ForecastWorkforceResponse;
  fleet: ListFleetResponse;
}) {
  const [pools, setPools] = useState(initialPools);
  const [forecast, setForecast] = useState(initialForecast);
  const [role, setRole] = useState<"pilot" | "cabin_crew" | "line_maintenance" | "ground_handling">(
    "pilot",
  );
  const [capacity, setCapacity] = useState("2");
  const [variantId, setVariantId] = useState(fleet[0]?.variantId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const starterPackages = recommendations as WorkforceStarterPackage[];

  async function refresh() {
    const through = new Date(Date.now() + 28 * 86_400_000).toISOString();
    const [nextPools, nextForecast] = await Promise.all([
      planningApi.workforcePools(airlineId),
      planningApi.forecastWorkforce(airlineId, through),
    ]);
    setPools(asWorkforcePools(nextPools));
    setForecast(nextForecast);
  }

  function hire(event: FormEvent) {
    event.preventDefault();
    const input = {
      role,
      capacity: Number(capacity),
      ...(role === "pilot" ? { qualificationAircraftVariantId: variantId } : {}),
    };
    const key = createStableIdempotencyKey(
      `ticket20:workforce-hire:${airlineId}`,
      JSON.stringify(input),
    );
    setError(null);
    startTransition(async () => {
      try {
        const result = await planningApi.hireWorkforce(airlineId, input, key);
        await refresh();
        setConfirmation(
          `Capacity enters service ${formatDateTime(result.availableAt)} after training. Hiring ${formatMoney(result.hiringCostMinor, result.pool.reportingCurrency)} + training ${formatMoney(result.trainingCostMinor, result.pool.reportingCurrency)}; authoritative pools refreshed.`,
        );
      } catch (cause) {
        setError(messageFor(cause));
      }
    });
  }

  return (
    <div className="focused-workspace workforce-workspace">
      <header className="workspace-titlebar">
        <div>
          <p className="context-label">Qualified aggregate capacity</p>
          <h2>Workforce pools and shortage recovery</h2>
          <p>
            Role, base, qualification, wages, training lead time, and fatigue constrain the active
            timetable.
          </p>
        </div>
        <div className="workspace-count">
          <UsersThree aria-hidden />
          <strong>{pools.reduce((sum, pool) => sum + pool.activeCapacity, 0)}</strong>
          <span>active capacity</span>
        </div>
      </header>
      {error ? (
        <StateMessage tone="critical" title="Workforce action blocked">
          {error}
        </StateMessage>
      ) : null}
      {confirmation ? (
        <StateMessage tone="nominal" title="Workforce refreshed">
          {confirmation}
        </StateMessage>
      ) : null}

      <div className="workforce-layout">
        <section className="workforce-pools" aria-labelledby="pools-title">
          <header>
            <div>
              <p className="context-label">Current pools</p>
              <h3 id="pools-title">Capacity by base and qualification</h3>
            </div>
            <ProvenanceLabel classification="balance" />
          </header>
          <OperationalTable label="Qualified workforce pools">
            <thead>
              <tr>
                <th>Base</th>
                <th>Role</th>
                <th>Qualification</th>
                <th>Active</th>
                <th>Training</th>
                <th>Wage interval</th>
                <th>Fatigue / availability</th>
              </tr>
            </thead>
            <tbody>
              {pools.map((pool) => (
                <tr key={pool.id}>
                  <th scope="row">{pool.baseIataCode}</th>
                  <td>{pool.role.replaceAll("_", " ")}</td>
                  <td>
                    <strong>{pool.qualification.code}</strong>
                    {pool.role === "pilot" ? (
                      <small>Type rating required for assigned aircraft</small>
                    ) : (
                      <small>General slice-one qualification</small>
                    )}
                  </td>
                  <td>{pool.activeCapacity}</td>
                  <td>
                    {pool.pendingCapacity}
                    {pool.nextAvailableAt ? (
                      <small>Available {formatDateTime(pool.nextAvailableAt)}</small>
                    ) : null}
                  </td>
                  <td>
                    {formatMoney(pool.wagePerIntervalMinor, pool.reportingCurrency)}
                    <small>Next due {formatDateTime(pool.nextWageDueAt)}</small>
                  </td>
                  <td>
                    {pool.nextAvailableAt
                      ? "Training lead time"
                      : "Available; flight allocations enforce duty recovery"}
                  </td>
                </tr>
              ))}
            </tbody>
          </OperationalTable>
        </section>

        <form
          className="workforce-hiring desktop-planning-action"
          onSubmit={hire}
          aria-labelledby="hire-title"
        >
          <header>
            <GraduationCap aria-hidden />
            <div>
              <h3 id="hire-title">Hire and train capacity</h3>
              <p>Complex staffing changes are desktop-first.</p>
            </div>
          </header>
          <Field label="Role" htmlFor="workforce-role">
            <select
              id="workforce-role"
              value={role}
              onChange={(event) => setRole(event.target.value as typeof role)}
            >
              <option value="pilot">Pilot</option>
              <option value="cabin_crew">Cabin crew</option>
              <option value="line_maintenance">Line maintenance</option>
              <option value="ground_handling">Ground handling</option>
            </select>
          </Field>
          {role === "pilot" ? (
            <Field
              label="Pilot type rating"
              htmlFor="workforce-variant"
              hint="Must match the aircraft variant assigned to affected flights"
            >
              <select
                id="workforce-variant"
                value={variantId}
                onChange={(event) => setVariantId(event.target.value)}
              >
                {fleet.map((aircraft) => (
                  <option key={aircraft.variantId} value={aircraft.variantId}>
                    {aircraft.manufacturer} {aircraft.model} · {aircraft.variantCode}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field
            label="Capacity"
            htmlFor="workforce-capacity"
            hint="Aggregate workers, not named employees"
          >
            <input
              id="workforce-capacity"
              inputMode="numeric"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button className="button-primary" type="submit" disabled={isPending || !capacity}>
            Review cost and begin training
          </Button>
          <div className="mobile-editor-handoff">
            <strong>Staffing changes require desktop</strong>
            <p>
              Mobile retains pool and shortage monitoring. Continue hiring or training on a larger
              screen.
            </p>
          </div>
        </form>
      </div>

      <section className="workforce-forecast" aria-labelledby="shortage-title">
        <header>
          <div>
            <p className="context-label">Active timetable forecast</p>
            <h3 id="shortage-title">Qualification and fatigue coverage</h3>
          </div>
          <span className="status-chip" data-status={forecast.feasible ? "ready" : "warning"}>
            {forecast.feasible ? "Feasible" : `${forecast.shortages.length} shortages`}
          </span>
        </header>
        <p>
          Generated {formatDateTime(forecast.generatedAt)} through{" "}
          {formatDateTime(forecast.through)}. Forecasts are advisory; allocation rechecks capacity
          transactionally.
        </p>
        {forecast.shortages.length ? (
          <div className="constraint-list">
            {forecast.shortages.map((raw, index) => {
              const shortage = raw as {
                flightId?: string;
                flightNumber?: string;
                role?: string;
                qualificationCode?: string;
                baseIataCode?: string;
                windowStartsAt?: string;
                windowEndsAt?: string;
                requiredCapacity?: number;
                availableCapacity?: number;
                shortfall?: number;
                correction?: string;
              };
              return (
                <article key={`${shortage.flightId ?? index}-${shortage.role ?? "role"}`}>
                  <Warning aria-hidden />
                  <div>
                    <strong>
                      {shortage.flightNumber ?? "Affected flight"} ·{" "}
                      {shortage.role?.replaceAll("_", " ")}
                    </strong>
                    <p>
                      {shortage.baseIataCode} {shortage.qualificationCode}: required{" "}
                      {shortage.requiredCapacity}, available {shortage.availableCapacity}, shortfall{" "}
                      {shortage.shortfall}.{" "}
                      {shortage.windowStartsAt
                        ? `${formatDateTime(shortage.windowStartsAt)}–${formatDateTime(shortage.windowEndsAt ?? shortage.windowStartsAt)}`
                        : ""}
                    </p>
                    <a href="/app?view=network">Review affected route and timetable</a>
                    <span>{shortage.correction}</span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <StateMessage tone="nominal" title="No active-timetable shortages">
            Current qualified pools cover the generated horizon under aggregate duty-recovery rules.
          </StateMessage>
        )}
      </section>

      <section className="starter-recommendations" aria-labelledby="recommendations-title">
        <header>
          <Clock aria-hidden />
          <div>
            <h3 id="recommendations-title">Starter capacity recommendations</h3>
            <p>Balance guidance by aircraft variant; not a separate difficulty rule.</p>
          </div>
        </header>
        <OperationalTable label="Workforce starter recommendations">
          <thead>
            <tr>
              <th>Aircraft type</th>
              <th>Pilot</th>
              <th>Cabin</th>
              <th>Maintenance</th>
              <th>Ground</th>
              <th>Explanation</th>
            </tr>
          </thead>
          <tbody>
            {starterPackages.map((item) => (
              <tr key={item.variantId}>
                <th scope="row">{item.variantCode}</th>
                <td>{item.minimumCapacity.pilot}</td>
                <td>{item.minimumCapacity.cabin_crew}</td>
                <td>{item.minimumCapacity.line_maintenance}</td>
                <td>{item.minimumCapacity.ground_handling}</td>
                <td>{item.explanation}</td>
              </tr>
            ))}
          </tbody>
        </OperationalTable>
      </section>
    </div>
  );
}

function messageFor(cause: unknown) {
  if (cause instanceof WebApiError) return cause.actionable.message;
  return "The workforce service could not complete the request. Entered capacity remains available.";
}
