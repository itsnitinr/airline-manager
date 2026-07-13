import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import {
  FlightLifecycleError,
  realizeFlight,
  type CurrencyCode,
  type FlightBoard,
  type FlightBoardQuery,
  type FlightBoardItem,
  type FlightMilestone,
  type FlightOperationsRepository,
  type FlightState,
  type FlightStatus,
  type OfflineFlightChanges,
  type RealizedFlightOutcome,
  type SettledFlightSnapshot,
} from "@airline-manager/domain";
import type { DB } from "../generated/database.js";
import type { Database } from "../database.js";
import { KyselyLedgerRepository } from "../finance/repository.js";
import { KyselyFuelRepository } from "../fuel/repository.js";
import { KyselyMaintenanceRepository } from "../maintenance/repository.js";
import { KyselyMarketRepository } from "../market/repository.js";
import { runInTransaction } from "../transactions.js";
import { KyselyWeatherRepository } from "../weather/repository.js";
import { KyselyWorkforceRepository } from "../workforce/repository.js";

type FlightContext = Readonly<{
  id: string;
  airline_id: string;
  player_account_id: string;
  flight_number: string;
  status: FlightState;
  version: string;
  departure_at: Date;
  arrival_at: Date;
  ready_at: Date;
  state_effective_at: Date;
  route_id: string;
  aircraft_id: string;
  origin_airport_id: string;
  destination_airport_id: string;
  diversion_airport_id: string | null;
  current_airport_id: string | null;
  delivery_state: string;
  planned_block_minutes: number;
  distance_nm: number;
  economy_seats: number;
  booked_passengers: string;
  realized_revenue_minor: string;
  reporting_currency: CurrencyCode;
  ruleset_version: string;
  aircraft_version: string;
  condition_basis_points: number;
  dispatch_reliability_basis_points: number;
}>;

type AdvanceOutcome = "applied" | "duplicate" | "stale" | "premature" | "noop";

const hash = (value: unknown) =>
  createHash("sha256")
    .update(
      JSON.stringify(value, (_, child) => (typeof child === "bigint" ? child.toString() : child)),
    )
    .digest("hex");

async function context(database: Database | Transaction<DB>, flightId: string, lock = false) {
  const result = await sql<FlightContext>`SELECT df.id, route.airline_id, own.player_account_id,
    df.flight_number, df.status, df.version::text, df.departure_at, df.arrival_at, df.ready_at,
    df.state_effective_at, df.route_id, df.aircraft_id, df.origin_airport_id, df.destination_airport_id,
    df.diversion_airport_id,
    aircraft.current_airport_id, aircraft.delivery_state, df.planned_block_minutes, route.distance_nm,
    cabin.economy_seats, offer.booked_passengers::text, offer.realized_revenue_minor::text,
    book.reporting_currency, df.ruleset_version, aircraft.version::text AS aircraft_version,
    aircraft.condition_basis_points, aircraft.dispatch_reliability_basis_points
    FROM dated_flights df JOIN airline_routes route ON route.id = df.route_id
    JOIN resource_ownerships own ON own.resource_type = 'airline' AND own.resource_id = route.airline_id
    JOIN aircraft ON aircraft.id = df.aircraft_id
    JOIN aircraft_cabin_configurations cabin ON cabin.aircraft_id = aircraft.id
    JOIN commercial_flight_offers offer ON offer.id = df.id
    JOIN ledger_books book ON book.owner_type = 'airline' AND book.owner_id = route.airline_id
    WHERE df.id = ${flightId}::uuid ${lock ? sql`FOR UPDATE OF df` : sql``}`.execute(database);
  const row = result.rows[0];
  if (!row) throw new FlightLifecycleError("flight_not_found", "Dated flight is unavailable.");
  return row;
}

async function insertMaterial(
  transaction: Transaction<DB>,
  flightId: string,
  stage: "booking_lock" | "dispatch" | "arrival",
  effectiveAt: Date,
  material: Readonly<Record<string, unknown>>,
) {
  await sql`INSERT INTO flight_material_snapshots
    (flight_id, stage, effective_at, material_inputs, input_hash, created_at)
    VALUES (${flightId}::uuid, ${stage}, ${effectiveAt.toISOString()}::timestamptz,
      ${JSON.stringify(material)}::jsonb, ${hash(material)}, CURRENT_TIMESTAMP)
    ON CONFLICT (flight_id, stage) DO NOTHING`.execute(transaction);
}

async function transition(
  transaction: Transaction<DB>,
  row: FlightContext,
  to: FlightState,
  milestone: FlightMilestone,
  commandId: string,
  effectiveAt: Date,
  processedAt: Date,
  reasonCode: string,
  explanation: string,
  extra = sql``,
): Promise<bigint> {
  const next = BigInt(row.version) + 1n;
  const updated = await sql`UPDATE dated_flights SET status = ${to}, version = version + 1,
    state_effective_at = ${effectiveAt.toISOString()}::timestamptz ${extra}
    WHERE id = ${row.id}::uuid AND version = ${row.version}::bigint AND status = ${row.status}`.execute(
    transaction,
  );
  if (updated.numAffectedRows !== 1n)
    throw new FlightLifecycleError("stale_flight_version", "Flight changed concurrently.");
  await sql`INSERT INTO flight_transition_history
    (flight_id, sequence, from_state, to_state, milestone, reason_code, explanation,
     effective_at, command_id, expected_version, resulting_version, recorded_at)
    VALUES (${row.id}::uuid,
      (SELECT COALESCE(max(sequence),0)+1 FROM flight_transition_history WHERE flight_id=${row.id}::uuid),
      ${row.status}, ${to}, ${milestone}, ${reasonCode}, ${explanation},
      ${effectiveAt.toISOString()}::timestamptz, ${commandId}::uuid, ${row.version}::bigint,
      ${next.toString()}::bigint, ${processedAt.toISOString()}::timestamptz)`.execute(transaction);
  await sql`INSERT INTO outbox_events
    (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at, available_at,
     command_id, correlation_id, causation_id, handler_kind, handler_version)
    VALUES ('dated_flight', ${row.id}::uuid, ${next.toString()}::bigint, 'flight.state_changed.v1',
      ${JSON.stringify({ flightId: row.id, airlineId: row.airline_id, from: row.status, to, effectiveAt: effectiveAt.toISOString(), reasonCode })}::jsonb,
      ${effectiveAt.toISOString()}::timestamptz, ${processedAt.toISOString()}::timestamptz,
      ${commandId}::uuid, gen_random_uuid(), ${commandId}::uuid, 'outbox.event', 1)`.execute(
    transaction,
  );
  return next;
}

async function registerNext(
  transaction: Transaction<DB>,
  row: FlightContext,
  expectedVersion: bigint,
  milestone: FlightMilestone,
  target: Date,
) {
  await sql`INSERT INTO simulation_milestones
    (entity_type, entity_id, expected_version, handler_kind, handler_version, target_time,
     command_id, correlation_id, causation_id, routing)
    VALUES ('dated_flight', ${row.id}::uuid, ${expectedVersion.toString()}::bigint,
      ${`flight.${milestone}`}, 1, ${target.toISOString()}::timestamptz, gen_random_uuid(),
      gen_random_uuid(), gen_random_uuid(), jsonb_build_object('source','flight_lifecycle'))
    ON CONFLICT DO NOTHING`.execute(transaction);
}

export class KyselyFlightOperationsRepository implements FlightOperationsRepository {
  readonly #market: KyselyMarketRepository;
  readonly #weather: KyselyWeatherRepository;
  readonly #workforce: KyselyWorkforceRepository;
  readonly #maintenance: KyselyMaintenanceRepository;
  readonly #fuel: KyselyFuelRepository;

  public constructor(private readonly database: Database) {
    this.#market = new KyselyMarketRepository(database);
    this.#weather = new KyselyWeatherRepository(database);
    this.#workforce = new KyselyWorkforceRepository(database);
    this.#maintenance = new KyselyMaintenanceRepository(database);
    this.#fuel = new KyselyFuelRepository(database);
  }

  public async advanceMilestone(
    flightId: string,
    milestone: FlightMilestone,
    expectedVersion: bigint,
    commandId: string,
    effectiveAt: Date,
    processedAt: Date,
  ): Promise<AdvanceOutcome> {
    if (effectiveAt > processedAt) return "premature";
    let row = await context(this.database, flightId);
    if (BigInt(row.version) !== expectedVersion) {
      const previous = await sql<{
        outcome: AdvanceOutcome;
      }>`SELECT outcome FROM flight_lifecycle_commands
        WHERE command_id=${commandId}::uuid`.execute(this.database);
      return previous.rows[0]?.outcome === "applied"
        ? "duplicate"
        : (previous.rows[0]?.outcome ?? "stale");
    }
    try {
      if (milestone === "booking_lock") {
        await this.#market.refreshBookings(
          row.player_account_id,
          row.airline_id,
          row.id,
          effectiveAt,
          `flight:${row.id}:booking-lock`,
        );
        await this.#weather.forecastDeparture(
          row.player_account_id,
          row.airline_id,
          row.id,
          effectiveAt,
        );
      } else if (milestone === "dispatch") {
        if (row.delivery_state !== "delivered" || row.current_airport_id !== row.origin_airport_id)
          throw new FlightLifecycleError(
            "dispatch_requirement_failed",
            "Aircraft is unavailable or positioned at the wrong airport.",
            [
              "Return the assigned delivered aircraft to the scheduled origin and preserve turnaround.",
            ],
          );
        const maintenance = await this.#maintenance.dispatchReadiness(
          row.player_account_id,
          row.airline_id,
          row.aircraft_id,
          effectiveAt,
        );
        if (!maintenance.dispatchReady)
          throw new FlightLifecycleError(
            "dispatch_requirement_failed",
            "Maintenance safety requirements block dispatch.",
            maintenance.recoverySteps,
          );
        await this.#workforce.allocateFlight(
          row.player_account_id,
          row.airline_id,
          row.id,
          processedAt,
        );
        const forecast = await sql<{ id: string }>`SELECT id FROM weather_forecast_snapshots
          WHERE scope='departure' AND scope_id=${row.id}::uuid ORDER BY issued_at DESC LIMIT 1`.execute(
          this.database,
        );
        const weather = forecast.rows[0]
          ? await this.#weather.realizeForecast(forecast.rows[0].id, effectiveAt)
          : undefined;
        const outcome = realizeFlight({
          plannedBlockMinutes: row.planned_block_minutes,
          bookedPassengers: BigInt(row.booked_passengers),
          sellableSeats: BigInt(row.economy_seats),
          bookedRevenueMinor: BigInt(row.realized_revenue_minor),
          weatherBlockTimeBasisPoints: weather?.plan.expectedBlockTimeBasisPoints ?? 10_000,
          weatherFuelBurnBasisPoints: weather?.plan.expectedFuelBurnBasisPoints ?? 10_000,
          weatherDelayRiskBasisPoints: weather?.plan.congestionDelayRiskBasisPoints ?? 0,
          weatherDiversionRiskBasisPoints: weather?.plan.diversionRiskBasisPoints ?? 0,
          distanceNm: row.distance_nm,
          economySeats: row.economy_seats,
          seed: `${row.id}|${row.ruleset_version}|flight-realization-v1`,
        });
        await this.#fuel.consume(
          row.airline_id,
          BigInt(outcome.fuelBurnKg),
          "dated_flight",
          row.id,
          `flight:${row.id}:fuel`,
          effectiveAt,
        );
        await sql`INSERT INTO flight_operational_results
          (flight_id, formula_version, seed, realized_block_minutes, delay_minutes, diverted,
           passengers_carried, fuel_burn_kg, passenger_revenue_minor, refund_minor,
           airport_cost_minor, wage_allocation_minor, maintenance_allocation_minor,
           operating_result_minor, result_snapshot, realized_at)
          VALUES (${row.id}::uuid, 'flight-realization-v1', ${`${row.id}|${row.ruleset_version}|flight-realization-v1`},
            ${outcome.realizedBlockMinutes}, ${outcome.delayMinutes}, ${outcome.diverted},
            ${outcome.passengersCarried}::bigint, ${outcome.fuelBurnKg}::bigint,
            ${outcome.passengerRevenueMinor}::bigint, ${outcome.refundMinor}::bigint,
            ${outcome.airportCostMinor}::bigint, ${outcome.wageAllocationMinor}::bigint,
            ${outcome.maintenanceAllocationMinor}::bigint, ${outcome.operatingResultMinor}::bigint,
            ${JSON.stringify(outcome)}::jsonb, ${effectiveAt.toISOString()}::timestamptz)
          ON CONFLICT (flight_id) DO NOTHING`.execute(this.database);
      } else if (milestone === "arrival" && row.status !== "diverted") {
        const result = await sql<{ result_snapshot: RealizedFlightOutcome }>`SELECT result_snapshot
          FROM flight_operational_results WHERE flight_id=${row.id}::uuid`.execute(this.database);
        const outcome = result.rows[0]?.result_snapshot;
        if (!outcome) throw new Error("Persisted flight realization is unavailable.");
        await this.#maintenance.recordFlightCompletion(
          row.player_account_id,
          row.airline_id,
          {
            completionKey: `flight:${row.id}:utilization`,
            aircraftId: row.aircraft_id,
            completedAt: effectiveAt.toISOString(),
            blockMinutes: outcome.realizedBlockMinutes,
            cycles: 1,
            faultSeed: `${row.id}|maintenance-fault-v1`,
          },
          processedAt,
        );
      }
    } catch (error) {
      if (milestone !== "dispatch") throw error;
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "dispatch_requirement_failed";
      const steps =
        error instanceof FlightLifecycleError
          ? error.recoverySteps
          : "shortages" in (error as object)
            ? ((error as { shortages?: Array<{ correction: string }> }).shortages ?? []).map(
                (item) => item.correction,
              )
            : [
                "Restore fuel, qualified workforce, aircraft position, and maintenance readiness before the bounded retry.",
              ];
      return this.suspend(
        row,
        expectedVersion,
        commandId,
        effectiveAt,
        processedAt,
        code,
        error instanceof Error ? error.message : "Dispatch requirement failed.",
        steps,
      );
    }

    row = await context(this.database, flightId);
    return runInTransaction(
      this.database,
      async (transaction) => {
        const locked = await context(transaction, flightId, true);
        if (BigInt(locked.version) !== expectedVersion) {
          const previous = await sql<{
            outcome: AdvanceOutcome;
          }>`SELECT outcome FROM flight_lifecycle_commands
            WHERE command_id=${commandId}::uuid`.execute(transaction);
          return previous.rows[0]?.outcome === "applied" ? "duplicate" : "stale";
        }
        const inputHash = hash({
          flightId,
          milestone,
          expectedVersion: expectedVersion.toString(),
          effectiveAt,
        });
        const existing = await sql<{
          input_hash: string;
          outcome: AdvanceOutcome;
        }>`SELECT input_hash, outcome
          FROM flight_lifecycle_commands WHERE command_id=${commandId}::uuid FOR UPDATE`.execute(
          transaction,
        );
        if (existing.rows[0]) {
          if (existing.rows[0].input_hash.trim() !== inputHash)
            throw new FlightLifecycleError(
              "idempotency_conflict",
              "Milestone command identity was reused.",
            );
          return existing.rows[0].outcome === "applied" ? "duplicate" : existing.rows[0].outcome;
        }
        await sql`INSERT INTO flight_lifecycle_commands
          (command_id, flight_id, milestone, expected_version, effective_at, input_hash, outcome, processed_at)
          VALUES (${commandId}::uuid, ${flightId}::uuid, ${milestone}, ${expectedVersion.toString()}::bigint,
            ${effectiveAt.toISOString()}::timestamptz, ${inputHash}, 'processing', ${processedAt.toISOString()}::timestamptz)`.execute(
          transaction,
        );
        let next: bigint;
        if (milestone === "booking_lock" && locked.status === "scheduled") {
          const material = await this.material(transaction, locked, "booking_lock");
          await insertMaterial(transaction, flightId, "booking_lock", effectiveAt, material);
          next = await transition(
            transaction,
            locked,
            "boarding",
            milestone,
            commandId,
            effectiveAt,
            processedAt,
            "bookings_locked",
            "Bookings and pricing were frozen exactly once at boarding lock.",
          );
          await registerNext(transaction, locked, next, "dispatch", locked.departure_at);
        } else if (
          milestone === "dispatch" &&
          ["boarding", "delayed", "suspended"].includes(locked.status)
        ) {
          const material = await this.material(transaction, locked, "dispatch");
          await insertMaterial(transaction, flightId, "dispatch", effectiveAt, material);
          next = await transition(
            transaction,
            locked,
            "departed",
            milestone,
            commandId,
            effectiveAt,
            processedAt,
            "dispatch_revalidated",
            "All hard dispatch requirements were revalidated and resources consumed exactly once.",
            sql`, actual_departure_at=${effectiveAt.toISOString()}::timestamptz,
              suspension_reason_code=NULL, suspension_explanation=NULL, suspension_recovery_steps=NULL,
              suspension_next_retry_at=NULL`,
          );
          const result = await sql<{ realized_block_minutes: number }>`SELECT realized_block_minutes
            FROM flight_operational_results WHERE flight_id=${flightId}::uuid`.execute(transaction);
          await registerNext(
            transaction,
            locked,
            next,
            "arrival",
            new Date(effectiveAt.getTime() + result.rows[0]!.realized_block_minutes * 60_000),
          );
        } else if (milestone === "arrival" && locked.status === "departed") {
          const result = await sql<{
            diverted: boolean;
          }>`SELECT diverted FROM flight_operational_results
            WHERE flight_id=${flightId}::uuid`.execute(transaction);
          const diverted = result.rows[0]?.diverted ?? false;
          next = await transition(
            transaction,
            locked,
            diverted ? "diverted" : "arrived",
            milestone,
            commandId,
            effectiveAt,
            processedAt,
            diverted ? "weather_diversion" : "arrival_completed",
            diverted
              ? "Persisted realized conditions produced a bounded non-fatal diversion."
              : "The aircraft arrived at the scheduled destination.",
            diverted
              ? sql`, diversion_airport_id=${locked.origin_airport_id}::uuid`
              : sql`, actual_arrival_at=${effectiveAt.toISOString()}::timestamptz`,
          );
          if (diverted) await registerNext(transaction, locked, next, "arrival", effectiveAt);
          else {
            await sql`UPDATE aircraft SET current_airport_id=${locked.destination_airport_id}::uuid,
              planned_airport_id=${locked.destination_airport_id}::uuid, version=version+1
              WHERE id=${locked.aircraft_id}::uuid`.execute(transaction);
            await insertMaterial(
              transaction,
              flightId,
              "arrival",
              effectiveAt,
              await this.material(
                transaction,
                { ...locked, status: "arrived", version: next.toString() },
                "arrival",
              ),
            );
            await registerNext(transaction, locked, next, "settlement", effectiveAt);
          }
        } else if (milestone === "arrival" && locked.status === "diverted") {
          next = await transition(
            transaction,
            locked,
            "arrived",
            milestone,
            commandId,
            effectiveAt,
            processedAt,
            "diversion_recovery_arrival",
            "The bounded diversion completed at the persisted diversion airport.",
            sql`, actual_arrival_at=${effectiveAt.toISOString()}::timestamptz`,
          );
          await sql`UPDATE aircraft SET current_airport_id=${locked.diversion_airport_id ?? locked.origin_airport_id}::uuid,
            planned_airport_id=${locked.diversion_airport_id ?? locked.origin_airport_id}::uuid, version=version+1
            WHERE id=${locked.aircraft_id}::uuid`.execute(transaction);
          await insertMaterial(
            transaction,
            flightId,
            "arrival",
            effectiveAt,
            await this.material(
              transaction,
              { ...locked, status: "arrived", version: next.toString() },
              "arrival",
            ),
          );
          await registerNext(transaction, locked, next, "settlement", effectiveAt);
        } else if (milestone === "settlement" && ["arrived", "cancelled"].includes(locked.status)) {
          const settlement = await this.postSettlement(
            transaction,
            locked,
            effectiveAt,
            processedAt,
          );
          next = await transition(
            transaction,
            locked,
            "settled",
            milestone,
            commandId,
            effectiveAt,
            processedAt,
            "settlement_posted",
            "Balanced journals, authoritative state, outbox intent, and immutable snapshot committed atomically.",
            sql`, settled_at=${effectiveAt.toISOString()}::timestamptz`,
          );
          void settlement;
        } else return "noop";
        await sql`UPDATE flight_lifecycle_commands SET outcome='applied', resulting_version=${next.toString()}::bigint,
          result=${JSON.stringify({ state: milestone, version: next.toString() })}::jsonb
          WHERE command_id=${commandId}::uuid`.execute(transaction);
        return "applied";
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }

  private async suspend(
    row: FlightContext,
    expectedVersion: bigint,
    commandId: string,
    effectiveAt: Date,
    processedAt: Date,
    reasonCode: string,
    explanation: string,
    recoverySteps: readonly string[],
  ): Promise<AdvanceOutcome> {
    return runInTransaction(
      this.database,
      async (transaction) => {
        const locked = await context(transaction, row.id, true);
        if (BigInt(locked.version) !== expectedVersion) {
          const previous = await sql<{
            outcome: AdvanceOutcome;
          }>`SELECT outcome FROM flight_lifecycle_commands
            WHERE command_id=${commandId}::uuid`.execute(transaction);
          return previous.rows[0]?.outcome === "applied" ? "duplicate" : "stale";
        }
        const inputHash = hash({
          flightId: row.id,
          milestone: "dispatch",
          expectedVersion: expectedVersion.toString(),
          effectiveAt,
        });
        const inserted = await sql`INSERT INTO flight_lifecycle_commands
          (command_id, flight_id, milestone, expected_version, effective_at, input_hash, outcome, processed_at)
          VALUES (${commandId}::uuid, ${row.id}::uuid, 'dispatch', ${expectedVersion.toString()}::bigint,
            ${effectiveAt.toISOString()}::timestamptz, ${inputHash}, 'processing', ${processedAt.toISOString()}::timestamptz)
          ON CONFLICT (command_id) DO NOTHING`.execute(transaction);
        if (inserted.numAffectedRows === 0n) return "duplicate";
        await sql`UPDATE workforce_allocations SET status='released', released_at=${processedAt.toISOString()}::timestamptz
        WHERE dated_flight_id=${row.id}::uuid AND status='reserved'`.execute(transaction);
        const retry = locked.status === "suspended" ? 2 : locked.status === "delayed" ? 3 : 1;
        const cancelled = retry >= 3;
        const targetState: FlightState = cancelled
          ? "cancelled"
          : retry === 1
            ? "suspended"
            : "delayed";
        const nextRetry = new Date(effectiveAt.getTime() + 15 * 60_000);
        const next = await transition(
          transaction,
          locked,
          targetState,
          "dispatch",
          commandId,
          effectiveAt,
          processedAt,
          cancelled ? "bounded_dispatch_cancellation" : reasonCode,
          cancelled
            ? "Dispatch remained infeasible through the bounded recovery window; further debt and retries stop."
            : explanation,
          sql`, suspension_reason_code=${reasonCode}, suspension_explanation=${explanation},
          suspension_recovery_steps=${JSON.stringify(recoverySteps)}::jsonb,
          suspension_retry_count=${retry}, suspension_next_retry_at=${cancelled ? null : nextRetry.toISOString()}::timestamptz,
          cancellation_reason_code=${cancelled ? reasonCode : null}`,
        );
        if (cancelled) await registerNext(transaction, locked, next, "settlement", effectiveAt);
        else await registerNext(transaction, locked, next, "dispatch", nextRetry);
        await sql`UPDATE flight_lifecycle_commands SET outcome='applied', resulting_version=${next.toString()}::bigint,
          result=${JSON.stringify({ state: targetState, version: next.toString(), reasonCode })}::jsonb
          WHERE command_id=${commandId}::uuid`.execute(transaction);
        return "applied";
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }

  private async material(transaction: Transaction<DB>, row: FlightContext, stage: string) {
    const records = await sql<Record<string, unknown>>`SELECT
      to_jsonb(df) AS flight, to_jsonb(route) AS route, to_jsonb(aircraft) AS aircraft,
      to_jsonb(cabin) AS cabin, to_jsonb(offer) AS booking_offer,
      COALESCE((SELECT jsonb_agg(to_jsonb(total) ORDER BY total.segment, total.booking_class)
        FROM booking_aggregate_totals total WHERE total.offer_id=df.id), '[]'::jsonb) AS booking_aggregates,
      COALESCE((SELECT jsonb_agg(to_jsonb(allocation) ORDER BY allocation.role)
        FROM workforce_allocations allocation WHERE allocation.dated_flight_id=df.id), '[]'::jsonb) AS workforce,
      (SELECT to_jsonb(forecast) FROM weather_forecast_snapshots forecast
        WHERE forecast.scope='departure' AND forecast.scope_id=df.id ORDER BY issued_at DESC LIMIT 1) AS weather_forecast,
      (SELECT to_jsonb(realized) FROM weather_realized_snapshots realized JOIN weather_forecast_snapshots forecast
        ON forecast.id=realized.forecast_snapshot_id WHERE forecast.scope_id=df.id LIMIT 1) AS weather_realized,
      (SELECT to_jsonb(result) FROM flight_operational_results result WHERE result.flight_id=df.id) AS operational_result,
      (SELECT to_jsonb(maintenance) FROM aircraft_maintenance_assignments maintenance WHERE maintenance.aircraft_id=df.aircraft_id) AS maintenance,
      (SELECT to_jsonb(inventory) FROM airline_fuel_inventories inventory WHERE inventory.airline_id=route.airline_id) AS fuel
      FROM dated_flights df JOIN airline_routes route ON route.id=df.route_id
      JOIN aircraft ON aircraft.id=df.aircraft_id JOIN aircraft_cabin_configurations cabin ON cabin.aircraft_id=aircraft.id
      JOIN commercial_flight_offers offer ON offer.id=df.id WHERE df.id=${row.id}::uuid`.execute(
      transaction,
    );
    return {
      stage,
      effectiveVersion: row.version,
      capturedAtEffectiveTime: row.state_effective_at.toISOString(),
      ...records.rows[0],
    };
  }

  private async postSettlement(
    transaction: Transaction<DB>,
    row: FlightContext,
    effectiveAt: Date,
    processedAt: Date,
  ) {
    const result = await sql<{ result_snapshot: RealizedFlightOutcome }>`SELECT result_snapshot
      FROM flight_operational_results WHERE flight_id=${row.id}::uuid`.execute(transaction);
    const outcome = result.rows[0]?.result_snapshot ?? {
      realizedBlockMinutes: 0,
      delayMinutes: 0,
      diverted: false,
      passengersCarried: "0",
      fuelBurnKg: "0",
      passengerRevenueMinor: "0",
      refundMinor: row.realized_revenue_minor,
      airportCostMinor: "5000",
      wageAllocationMinor: "0",
      maintenanceAllocationMinor: "0",
      operatingResultMinor: String(-BigInt(row.realized_revenue_minor) - 5000n),
      formulaVersion: "flight-realization-v1",
    };
    const book = await sql<{ id: string; period_id: string }>`SELECT book.id, period.id AS period_id
      FROM ledger_books book JOIN accounting_periods period ON period.ledger_book_id=book.id AND period.status='open'
      WHERE book.owner_type='airline' AND book.owner_id=${row.airline_id}::uuid`.execute(
      transaction,
    );
    const ledger = new KyselyLedgerRepository(transaction, true);
    const dimensions = {
      airlineId: row.airline_id,
      aircraftId: row.aircraft_id,
      routeId: row.route_id,
      flightId: row.id,
    };
    const specs = [
      [
        "revenue",
        BigInt(outcome.passengerRevenueMinor),
        "revenue",
        "4000",
        "credit",
        "1000",
        "debit",
      ],
      ["refund", BigInt(outcome.refundMinor), "refund", "5900", "debit", "1000", "credit"],
      [
        "airport_cost",
        BigInt(outcome.airportCostMinor),
        "airport_cost",
        "5300",
        "debit",
        "1000",
        "credit",
      ],
      ["wages", BigInt(outcome.wageAllocationMinor), "wages", "5100", "debit", "1000", "credit"],
      [
        "maintenance",
        BigInt(outcome.maintenanceAllocationMinor),
        "maintenance",
        "5200",
        "debit",
        "1000",
        "credit",
      ],
    ] as const;
    const journalIds: string[] = [];
    for (const [component, amount, commandType, account, side, cash, cashSide] of specs) {
      let journalEntryId: string | undefined;
      if (amount > 0n) {
        journalEntryId = (
          await ledger.post({
            ledgerBookId: book.rows[0]!.id,
            accountingPeriodId: book.rows[0]!.period_id,
            idempotencyKey: `flight:${row.id}:${component}`,
            commandType,
            description: `Flight ${row.flight_number} ${component.replaceAll("_", " ")}`,
            occurredAt: effectiveAt,
            transactionCurrency: row.reporting_currency,
            reportingCurrency: row.reporting_currency,
            postings: [
              {
                accountCode: account,
                side,
                transactionAmountMinor: amount,
                reportingAmountMinor: amount,
                dimensions,
              },
              {
                accountCode: cash,
                side: cashSide,
                transactionAmountMinor: amount,
                reportingAmountMinor: amount,
                dimensions,
              },
            ],
          })
        ).journalEntryId;
        journalIds.push(journalEntryId);
      }
      await sql`INSERT INTO flight_settlement_journals (flight_id, component, amount_minor, journal_entry_id)
        VALUES (${row.id}::uuid, ${component}, ${amount.toString()}::bigint, ${journalEntryId ?? null}::uuid)`.execute(
        transaction,
      );
    }
    const fuel = await sql<{
      inventory_value_delta_minor: string;
      ledger_journal_entry_id: string | null;
      id: string;
    }>`SELECT
      inventory_value_delta_minor::text, ledger_journal_entry_id, id FROM fuel_inventory_movements
      WHERE airline_id=${row.airline_id}::uuid AND source_type='dated_flight' AND source_id=${row.id}
      ORDER BY occurred_at DESC LIMIT 1`.execute(transaction);
    const fuelCost = fuel.rows[0] ? -BigInt(fuel.rows[0].inventory_value_delta_minor) : 0n;
    if (fuel.rows[0]?.ledger_journal_entry_id)
      journalIds.push(fuel.rows[0].ledger_journal_entry_id);
    await sql`INSERT INTO flight_settlement_journals (flight_id, component, amount_minor, journal_entry_id)
      VALUES (${row.id}::uuid, 'fuel', ${fuelCost.toString()}::bigint, ${fuel.rows[0]?.ledger_journal_entry_id ?? null}::uuid)`.execute(
      transaction,
    );
    const materialRows = await sql<{
      stage: string;
      material_inputs: Record<string, unknown>;
      input_hash: string;
    }>`SELECT
      stage, material_inputs, input_hash FROM flight_material_snapshots WHERE flight_id=${row.id}::uuid ORDER BY effective_at`.execute(
      transaction,
    );
    const materialInputs = Object.fromEntries(
      materialRows.rows.map((item) => [item.stage, item.material_inputs]),
    );
    const finalOutcome = {
      ...outcome,
      fuelCostMinor: fuelCost.toString(),
      operatingResultMinor: (BigInt(outcome.operatingResultMinor) - fuelCost).toString(),
    };
    const reconciliation = {
      fuelMovementId: fuel.rows[0]?.id ?? "none",
      aircraftId: row.aircraft_id,
      bookingOfferId: row.id,
      workforceAllocationFlightId: row.id,
      maintenanceCompletionKey: `flight:${row.id}:utilization`,
    };
    const snapshotMaterial = {
      schemaVersion: 1,
      flightId: row.id,
      materialInputs,
      outcome: finalOutcome,
      journalEntryIds: journalIds,
      reconciliation,
      rulesetVersions: { flight: "flight-realization-v1", world: row.ruleset_version },
    };
    const contentHash = hash(snapshotMaterial);
    const inserted = await sql<{ id: string }>`INSERT INTO settled_flight_snapshots
      (flight_id, schema_version, material_inputs, outcome, aggregates, ruleset_versions,
       reconciliation_references, journal_entry_ids, content_hash, settled_at, created_at)
      VALUES (${row.id}::uuid, 1, ${JSON.stringify(materialInputs)}::jsonb, ${JSON.stringify(finalOutcome)}::jsonb,
        ${JSON.stringify({ passengersCarried: outcome.passengersCarried, bookedPassengers: row.booked_passengers })}::jsonb,
        ${JSON.stringify({ flight: "flight-realization-v1", world: row.ruleset_version })}::jsonb,
        ${JSON.stringify(reconciliation)}::jsonb, ${JSON.stringify(journalIds)}::jsonb, ${contentHash},
        ${effectiveAt.toISOString()}::timestamptz, ${processedAt.toISOString()}::timestamptz) RETURNING id`.execute(
      transaction,
    );
    return inserted.rows[0]!.id;
  }

  public async status(
    playerAccountId: string,
    airlineId: string,
    flightId: string,
  ): Promise<FlightStatus> {
    const row = await context(this.database, flightId);
    if (row.player_account_id !== playerAccountId || row.airline_id !== airlineId)
      throw new FlightLifecycleError("flight_not_found", "Dated flight is unavailable.");
    const timeline = await sql<{
      sequence: string;
      from_state: FlightState | null;
      to_state: FlightState;
      milestone: FlightMilestone | "automatic";
      reason_code: string;
      explanation: string;
      effective_at: Date;
    }>`SELECT
      sequence::text, from_state, to_state, milestone, reason_code, explanation, effective_at
      FROM flight_transition_history WHERE flight_id=${flightId}::uuid ORDER BY sequence`.execute(
      this.database,
    );
    const suspension = await sql<{
      suspension_reason_code: string | null;
      suspension_explanation: string | null;
      suspension_recovery_steps: string[] | null;
      suspension_retry_count: number;
      suspension_next_retry_at: Date | null;
    }>`SELECT
      suspension_reason_code, suspension_explanation, suspension_recovery_steps, suspension_retry_count,
      suspension_next_retry_at FROM dated_flights WHERE id=${flightId}::uuid`.execute(
      this.database,
    );
    const issue = suspension.rows[0]!;
    return {
      id: row.id,
      airlineId: row.airline_id,
      flightNumber: row.flight_number,
      state: row.status,
      version: row.version,
      departureAt: row.departure_at.toISOString(),
      scheduledArrivalAt: row.arrival_at.toISOString(),
      effectiveAt: row.state_effective_at.toISOString(),
      ...(issue.suspension_reason_code
        ? {
            suspension: {
              reasonCode: issue.suspension_reason_code,
              explanation: issue.suspension_explanation!,
              recoverySteps: issue.suspension_recovery_steps ?? [],
              retryCount: issue.suspension_retry_count,
              ...(issue.suspension_next_retry_at
                ? { nextRetryAt: issue.suspension_next_retry_at.toISOString() }
                : {}),
            },
          }
        : {}),
      timeline: timeline.rows.map((item) => ({
        sequence: item.sequence,
        fromState: item.from_state,
        toState: item.to_state,
        milestone: item.milestone,
        reasonCode: item.reason_code,
        explanation: item.explanation,
        effectiveAt: item.effective_at.toISOString(),
      })),
    };
  }

  public async settlement(
    playerAccountId: string,
    airlineId: string,
    flightId: string,
  ): Promise<SettledFlightSnapshot> {
    const row = await context(this.database, flightId);
    if (row.player_account_id !== playerAccountId || row.airline_id !== airlineId)
      throw new FlightLifecycleError("flight_not_found", "Settled flight is unavailable.");
    const result = await sql<{
      id: string;
      schema_version: 1;
      settled_at: Date;
      material_inputs: Record<string, unknown>;
      outcome: SettledFlightSnapshot["outcome"];
      journal_entry_ids: string[];
      reconciliation_references: Record<string, string>;
      content_hash: string;
    }>`SELECT id, schema_version, settled_at,
      material_inputs, outcome, journal_entry_ids, reconciliation_references, content_hash
      FROM settled_flight_snapshots WHERE flight_id=${flightId}::uuid`.execute(this.database);
    const snapshot = result.rows[0];
    if (!snapshot)
      throw new FlightLifecycleError("flight_not_found", "Settled flight is unavailable.");
    return {
      id: snapshot.id,
      flightId,
      schemaVersion: snapshot.schema_version,
      settledAt: snapshot.settled_at.toISOString(),
      materialInputs: snapshot.material_inputs,
      outcome: snapshot.outcome,
      journalEntryIds: snapshot.journal_entry_ids,
      reconciliation: snapshot.reconciliation_references,
      contentHash: snapshot.content_hash,
    };
  }

  public async board(
    playerAccountId: string,
    airlineId: string,
    query: FlightBoardQuery,
  ): Promise<FlightBoard> {
    type Row = Readonly<{
      id: string;
      route_id: string;
      aircraft_id: string;
      flight_number: string;
      status: FlightState;
      version: string;
      departure_at: Date;
      arrival_at: Date;
      departure_local: string;
      arrival_local: string;
      state_effective_at: Date;
      origin_id: string;
      origin_iata: string;
      origin_name: string;
      origin_timezone: string;
      origin_latitude: string;
      origin_longitude: string;
      destination_id: string;
      destination_iata: string;
      destination_name: string;
      destination_timezone: string;
      destination_latitude: string;
      destination_longitude: string;
      serial_number: string;
      variant_code: string;
      current_airport_id: string | null;
      delay_minutes: number | null;
      booked_passengers: string;
      passengers_carried: string | null;
      realized_revenue_minor: string;
      reporting_currency: string;
      forecast_snapshot: Record<string, unknown>;
      suspension_reason_code: string | null;
      suspension_explanation: string | null;
      maintenance_blocking: boolean;
    }>;
    const states = query.states?.length ? sql`AND df.status = ANY(${query.states}::text[])` : sql``;
    const route = query.routeId ? sql`AND df.route_id=${query.routeId}::uuid` : sql``;
    const aircraft = query.aircraftId ? sql`AND df.aircraft_id=${query.aircraftId}::uuid` : sql``;
    const result = await sql<Row>`SELECT df.id, df.route_id, df.aircraft_id, df.flight_number,
      df.status, df.version::text, df.departure_at, df.arrival_at, df.departure_local,
      df.arrival_local, df.state_effective_at, origin.id AS origin_id,
      origin.iata_code AS origin_iata, origin.name AS origin_name,
      origin.timezone_name AS origin_timezone, origin.latitude_deg::text AS origin_latitude,
      origin.longitude_deg::text AS origin_longitude, destination.id AS destination_id,
      destination.iata_code AS destination_iata, destination.name AS destination_name,
      destination.timezone_name AS destination_timezone,
      destination.latitude_deg::text AS destination_latitude,
      destination.longitude_deg::text AS destination_longitude, item.serial_number,
      variant.code AS variant_code, item.current_airport_id, result.delay_minutes,
      offer.booked_passengers::text, result.passengers_carried::text,
      offer.realized_revenue_minor::text, book.reporting_currency, df.forecast_snapshot,
      df.suspension_reason_code, df.suspension_explanation,
      EXISTS (SELECT 1 FROM maintenance_faults fault WHERE fault.aircraft_id=df.aircraft_id
        AND fault.status='active' AND fault.grounds_aircraft) AS maintenance_blocking
      FROM dated_flights df
      JOIN airline_routes airline_route ON airline_route.id=df.route_id
      JOIN resource_ownerships ownership ON ownership.resource_type='airline'
        AND ownership.resource_id=airline_route.airline_id
      JOIN curated_airports origin ON origin.id=df.origin_airport_id
      JOIN curated_airports destination ON destination.id=df.destination_airport_id
      JOIN aircraft item ON item.id=df.aircraft_id
      JOIN curated_aircraft_variants variant ON variant.id=item.aircraft_variant_id
      JOIN commercial_flight_offers offer ON offer.id=df.id
      JOIN ledger_books book ON book.owner_type='airline' AND book.owner_id=airline_route.airline_id
      LEFT JOIN flight_operational_results result ON result.flight_id=df.id
      WHERE ownership.player_account_id=${playerAccountId}::uuid
        AND airline_route.airline_id=${airlineId}::uuid
        AND df.departure_at>=${query.from.toISOString()}::timestamptz
        AND df.departure_at<${query.to.toISOString()}::timestamptz
        ${states} ${route} ${aircraft}
      ORDER BY df.departure_at, df.id LIMIT ${query.limit + 1}`.execute(this.database);

    const items = result.rows.slice(0, query.limit).map((row): FlightBoardItem => {
      const alerts: FlightBoardItem["alerts"][number][] = [];
      if (row.suspension_reason_code) {
        const reason = row.suspension_reason_code;
        const kind = reason.includes("fuel")
          ? "fuel"
          : reason.includes("workforce")
            ? "workforce"
            : reason.includes("maintenance")
              ? "maintenance"
              : "suspension";
        const view = kind === "fuel" ? "fuel" : kind === "workforce" ? "workforce" : "maintenance";
        alerts.push({
          kind,
          severity: "critical",
          label: `${kind === "suspension" ? "Operational" : kind} suspension`,
          explanation:
            row.suspension_explanation ?? "The authoritative lifecycle suspended this flight.",
          recoveryPath: `/app?view=${view}`,
        });
      }
      if (row.maintenance_blocking && !alerts.some(({ kind }) => kind === "maintenance")) {
        alerts.push({
          kind: "maintenance",
          severity: "critical",
          label: "Aircraft fault",
          explanation: "An active persisted fault currently grounds this aircraft.",
          recoveryPath: `/app?view=maintenance&aircraft=${row.aircraft_id}`,
        });
      }
      const weatherSummary = Object.keys(row.forecast_snapshot ?? {}).length
        ? "Generated operational forecast is frozen with this dated flight."
        : null;
      return {
        id: row.id,
        airlineId,
        routeId: row.route_id,
        aircraftId: row.aircraft_id,
        flightNumber: row.flight_number,
        state: row.status,
        version: row.version,
        departureAt: row.departure_at.toISOString(),
        scheduledArrivalAt: row.arrival_at.toISOString(),
        departureLocal: row.departure_local,
        arrivalLocal: row.arrival_local,
        effectiveAt: row.state_effective_at.toISOString(),
        origin: {
          id: row.origin_id,
          iataCode: row.origin_iata,
          name: row.origin_name,
          timeZone: row.origin_timezone,
          latitudeDeg: row.origin_latitude,
          longitudeDeg: row.origin_longitude,
        },
        destination: {
          id: row.destination_id,
          iataCode: row.destination_iata,
          name: row.destination_name,
          timeZone: row.destination_timezone,
          latitudeDeg: row.destination_latitude,
          longitudeDeg: row.destination_longitude,
        },
        aircraft: {
          serialNumber: row.serial_number,
          variant: row.variant_code,
          currentAirportId: row.current_airport_id,
        },
        delayMinutes: row.delay_minutes ?? 0,
        passengersBooked: row.booked_passengers,
        passengersCarried: row.passengers_carried,
        bookedRevenueMinor: row.realized_revenue_minor,
        reportingCurrency: row.reporting_currency,
        weatherImpact: weatherSummary
          ? { summary: weatherSummary, provenance: "dated_flights.forecast_snapshot" }
          : null,
        alerts,
      };
    });
    const asOf = new Date().toISOString();
    return {
      asOf,
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      items,
      truncated: result.rows.length > query.limit,
    };
  }

  public async changes(
    playerAccountId: string,
    airlineId: string,
    since: Date,
    limit: number,
  ): Promise<OfflineFlightChanges> {
    const result = await sql<{
      flight_id: string;
      flight_number: string;
      from_state: FlightState | null;
      to_state: FlightState;
      effective_at: Date;
      explanation: string;
    }>`SELECT history.flight_id, flight.flight_number, history.from_state, history.to_state,
      history.effective_at, history.explanation
      FROM flight_transition_history history
      JOIN dated_flights flight ON flight.id=history.flight_id
      JOIN airline_routes route ON route.id=flight.route_id
      JOIN resource_ownerships ownership ON ownership.resource_type='airline'
        AND ownership.resource_id=route.airline_id
      WHERE ownership.player_account_id=${playerAccountId}::uuid
        AND route.airline_id=${airlineId}::uuid
        AND history.effective_at>${since.toISOString()}::timestamptz
      ORDER BY history.effective_at DESC, history.sequence DESC LIMIT ${limit}`.execute(
      this.database,
    );
    const byState: Partial<Record<FlightState, number>> = {};
    for (const row of result.rows) byState[row.to_state] = (byState[row.to_state] ?? 0) + 1;
    const through = new Date();
    return {
      asOf: through.toISOString(),
      since: since.toISOString(),
      through: through.toISOString(),
      total: result.rows.length,
      byState,
      items: result.rows.map((row) => ({
        flightId: row.flight_id,
        flightNumber: row.flight_number,
        fromState: row.from_state,
        toState: row.to_state,
        effectiveAt: row.effective_at.toISOString(),
        explanation: row.explanation,
      })),
    };
  }
}
