import { createHash, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import type {
  CurrencyCode,
  HireWorkforceInput,
  WorkforceAllocation,
  WorkforceFlightFacts,
  WorkforceForecast,
  WorkforceHire,
  WorkforcePool,
  WorkforceReadiness,
  WorkforceRepository,
  WorkforceRole,
  WorkforceStarterPackage,
  WorkforceWageAccrual,
} from "@airline-manager/domain";
import {
  WorkforceDomainError,
  demandForFlight,
  forecastWorkforce,
  qualificationCode,
  recoveryEndsAt,
} from "@airline-manager/domain";
import type { Database } from "../database.js";
import type { DB } from "../generated/database.js";
import { KyselyLedgerRepository } from "../finance/repository.js";
import { runInTransaction } from "../transactions.js";

type Queryable = Database | Transaction<DB>;

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type PoolRow = Readonly<{
  id: string;
  airline_id: string;
  base_airport_id: string;
  base_iata_code: string;
  role: WorkforceRole;
  qualification_code: string;
  qualification_aircraft_variant_id: string | null;
  catalog_release_id: string | null;
  active_capacity: number;
  pending_capacity: string;
  next_available_at: Date | null;
  wage_per_interval_minor: string;
  reporting_currency: string;
  wage_checkpoint_at: Date;
  next_wage_due_at: Date;
  version: string;
}>;

function mapPool(row: PoolRow): WorkforcePool {
  return {
    id: row.id,
    airlineId: row.airline_id,
    baseAirportId: row.base_airport_id,
    baseIataCode: row.base_iata_code,
    role: row.role,
    qualification: {
      code: row.qualification_code,
      ...(row.qualification_aircraft_variant_id
        ? { aircraftVariantId: row.qualification_aircraft_variant_id }
        : {}),
      ...(row.catalog_release_id ? { catalogReleaseId: row.catalog_release_id } : {}),
    },
    activeCapacity: row.active_capacity,
    pendingCapacity: Number(row.pending_capacity),
    ...(row.next_available_at ? { nextAvailableAt: row.next_available_at.toISOString() } : {}),
    wagePerIntervalMinor: row.wage_per_interval_minor,
    reportingCurrency: row.reporting_currency,
    wageCheckpointAt: row.wage_checkpoint_at.toISOString(),
    nextWageDueAt: row.next_wage_due_at.toISOString(),
    version: row.version,
  };
}

async function assertOwned(
  database: Queryable,
  playerAccountId: string,
  airlineId: string,
): Promise<void> {
  const owned = await sql<{ owned: boolean }>`SELECT EXISTS (
    SELECT 1 FROM resource_ownerships WHERE resource_type = 'airline'
      AND resource_id = ${airlineId}::uuid AND player_account_id = ${playerAccountId}::uuid
  ) AS owned`.execute(database);
  if (!owned.rows[0]?.owned)
    throw new WorkforceDomainError("workforce_not_found", "Workforce is unavailable.");
}

async function synchronizeDueTraining(
  transaction: Transaction<DB>,
  airlineId: string,
  now: Date,
): Promise<void> {
  const due = await sql<{
    id: string;
    workforce_pool_id: string;
    capacity: number;
    available_at: Date;
  }>`SELECT h.id, h.workforce_pool_id, h.capacity, h.available_at
    FROM workforce_hiring_orders h
    WHERE h.airline_id = ${airlineId}::uuid AND h.status = 'training'
      AND h.available_at <= ${now.toISOString()}::timestamptz
    ORDER BY h.workforce_pool_id, h.available_at, h.id FOR UPDATE`.execute(transaction);
  for (const order of due.rows) {
    await sql`SELECT id FROM workforce_pools WHERE id = ${order.workforce_pool_id}::uuid FOR UPDATE`.execute(
      transaction,
    );
    await sql`UPDATE workforce_pools SET active_capacity = active_capacity + ${order.capacity},
      wage_checkpoint_at = CASE WHEN active_capacity = 0 THEN ${order.available_at.toISOString()}::timestamptz ELSE wage_checkpoint_at END,
      next_wage_due_at = CASE WHEN active_capacity = 0 THEN ${order.available_at.toISOString()}::timestamptz +
        ((SELECT wage_interval_hours FROM workforce_ruleset_versions r WHERE r.id = workforce_pools.workforce_ruleset_version_id) * INTERVAL '1 hour')
        ELSE next_wage_due_at END,
      version = version + 1, updated_at = ${now.toISOString()}::timestamptz
      WHERE id = ${order.workforce_pool_id}::uuid`.execute(transaction);
    await sql`UPDATE workforce_hiring_orders SET status = 'available', activated_at = ${now.toISOString()}::timestamptz
      WHERE id = ${order.id}::uuid AND status = 'training'`.execute(transaction);
  }
  await sql`UPDATE workforce_pools p SET
    wage_checkpoint_at = COALESCE((SELECT min(h.wage_checkpoint_at) FROM workforce_hiring_orders h
      WHERE h.workforce_pool_id = p.id AND h.status = 'available'), p.wage_checkpoint_at),
    next_wage_due_at = COALESCE((SELECT min(h.next_wage_due_at) FROM workforce_hiring_orders h
      WHERE h.workforce_pool_id = p.id AND h.status = 'available'), p.next_wage_due_at)
    WHERE p.airline_id = ${airlineId}::uuid`.execute(transaction);
  await sql`UPDATE workforce_checkpoint_intents intent SET available_at = LEAST(
      COALESCE((SELECT min(h.available_at) FROM workforce_hiring_orders h
        WHERE h.workforce_pool_id = intent.workforce_pool_id AND h.status = 'training'), 'infinity'::timestamptz),
      COALESCE((SELECT min(h.next_wage_due_at) FROM workforce_hiring_orders h
        WHERE h.workforce_pool_id = intent.workforce_pool_id AND h.status = 'available'), 'infinity'::timestamptz)
    ), updated_at = ${now.toISOString()}::timestamptz
    WHERE EXISTS (SELECT 1 FROM workforce_pools p WHERE p.id = intent.workforce_pool_id
      AND p.airline_id = ${airlineId}::uuid)`.execute(transaction);
}

async function poolRows(database: Queryable, airlineId: string): Promise<readonly PoolRow[]> {
  const result = await sql<PoolRow>`SELECT p.id, p.airline_id, p.base_airport_id,
    airport.iata_code AS base_iata_code, p.role, p.qualification_code,
    p.qualification_aircraft_variant_id, p.catalog_release_id, p.active_capacity,
    COALESCE((SELECT sum(h.capacity) FROM workforce_hiring_orders h
      WHERE h.workforce_pool_id = p.id AND h.status = 'training'), 0)::text AS pending_capacity,
    (SELECT min(h.available_at) FROM workforce_hiring_orders h
      WHERE h.workforce_pool_id = p.id AND h.status = 'training') AS next_available_at,
    p.wage_per_interval_minor::text, p.reporting_currency, p.wage_checkpoint_at,
    p.next_wage_due_at, p.version::text
    FROM workforce_pools p JOIN curated_airports airport ON airport.id = p.base_airport_id
    WHERE p.airline_id = ${airlineId}::uuid ORDER BY p.role, p.qualification_code`.execute(
    database,
  );
  return result.rows;
}

type FlightRow = Readonly<{
  flight_id: string;
  flight_number: string;
  base_airport_id: string;
  base_iata_code: string;
  aircraft_variant_id: string;
  aircraft_variant_code: string;
  economy_seats: number;
  departure_at: Date;
  arrival_at: Date;
  planned_block_minutes: number;
  outsourced_ground_handling: boolean;
}>;

function mapFlight(row: FlightRow): WorkforceFlightFacts {
  return {
    flightId: row.flight_id,
    flightNumber: row.flight_number,
    baseAirportId: row.base_airport_id,
    baseIataCode: row.base_iata_code,
    aircraftVariantId: row.aircraft_variant_id,
    aircraftVariantCode: row.aircraft_variant_code,
    economySeats: row.economy_seats,
    departureAt: row.departure_at.toISOString(),
    arrivalAt: row.arrival_at.toISOString(),
    plannedBlockMinutes: row.planned_block_minutes,
    outsourcedGroundHandling: row.outsourced_ground_handling,
  };
}

const flightSelect = sql<FlightRow>`SELECT df.id AS flight_id, df.flight_number,
  station.airport_id AS base_airport_id, base.iata_code AS base_iata_code,
  aircraft.aircraft_variant_id, variant.code AS aircraft_variant_code,
  cabin.economy_seats, df.departure_at, df.arrival_at, df.planned_block_minutes,
  COALESCE((df.forecast_snapshot ->> 'outsourcedService')::boolean, true) AS outsourced_ground_handling
  FROM dated_flights df
  JOIN aircraft ON aircraft.id = df.aircraft_id
  JOIN curated_aircraft_variants variant ON variant.id = aircraft.aircraft_variant_id
  JOIN aircraft_cabin_configurations cabin ON cabin.aircraft_id = aircraft.id
  JOIN airlines airline ON airline.id = aircraft.operator_airline_id
  JOIN airline_stations station ON station.airline_id = airline.id AND station.station_role = 'principal_base'
  JOIN curated_airports base ON base.id = station.airport_id`;

export class KyselyWorkforceRepository implements WorkforceRepository {
  public constructor(private readonly database: Database) {}

  public async recommendations(
    playerAccountId: string,
    airlineId: string,
  ): Promise<readonly WorkforceStarterPackage[]> {
    await assertOwned(this.database, playerAccountId, airlineId);
    const rows = await sql<{
      aircraft_variant_id: string;
      aircraft_variant_code: string;
      ruleset_version: string;
      package: Record<WorkforceRole, number>;
      explanation: string;
    }>`SELECT s.aircraft_variant_id, s.aircraft_variant_code, r.version AS ruleset_version,
      s.package, s.explanation
      FROM workforce_starter_packages s
      JOIN workforce_ruleset_versions r ON r.id = s.workforce_ruleset_version_id AND r.status = 'active'
      JOIN careers c ON c.world_ruleset_id = r.world_ruleset_id
      JOIN airlines a ON a.career_id = c.id
      WHERE a.id = ${airlineId}::uuid ORDER BY s.aircraft_variant_code`.execute(this.database);
    return rows.rows.map((row) => ({
      variantId: row.aircraft_variant_id,
      variantCode: row.aircraft_variant_code,
      rulesetVersion: row.ruleset_version,
      minimumCapacity: row.package,
      explanation: row.explanation,
    }));
  }

  public async listPools(
    playerAccountId: string,
    airlineId: string,
    now: Date,
  ): Promise<readonly WorkforcePool[]> {
    return runInTransaction(this.database, async (transaction) => {
      await assertOwned(transaction, playerAccountId, airlineId);
      await synchronizeDueTraining(transaction, airlineId, now);
      return (await poolRows(transaction, airlineId)).map(mapPool);
    });
  }

  public async hire(
    playerAccountId: string,
    airlineId: string,
    input: HireWorkforceInput,
    idempotencyKey: string,
    now: Date,
  ): Promise<WorkforceHire> {
    if (!Number.isSafeInteger(input.capacity) || input.capacity <= 0 || input.capacity > 1000)
      throw new WorkforceDomainError(
        "invalid_capacity",
        "Capacity must be an integer from 1 to 1000.",
      );
    const hash = requestHash({ airlineId, ...input });
    return runInTransaction(
      this.database,
      async (transaction) => {
        await assertOwned(transaction, playerAccountId, airlineId);
        const scope = `workforce-hire:${airlineId}`;
        await sql`INSERT INTO idempotency_commands
          (scope, idempotency_key, command_type, request_hash, expires_at)
          VALUES (${scope}, ${idempotencyKey}, 'workforce_hire', ${hash},
            CURRENT_TIMESTAMP + INTERVAL '30 days') ON CONFLICT (scope, idempotency_key) DO NOTHING`.execute(
          transaction,
        );
        const idem = await sql<{ request_hash: string; state: string; response_body: unknown }>`
          SELECT request_hash, state, response_body FROM idempotency_commands
          WHERE scope = ${scope} AND idempotency_key = ${idempotencyKey} FOR UPDATE`.execute(
          transaction,
        );
        const command = idem.rows[0];
        if (!command) throw new Error("Workforce idempotency record is unavailable.");
        if (command.request_hash.trim() !== hash)
          throw new WorkforceDomainError(
            "idempotency_conflict",
            "Idempotency key was reused with different hiring terms.",
          );
        if (command.state === "completed") return command.response_body as WorkforceHire;

        const context = await sql<{
          base_airport_id: string;
          station_id: string;
          catalog_release_id: string;
          reporting_currency: CurrencyCode;
          workforce_ruleset_version_id: string;
          training_lead_hours: number;
          hiring_cost_minor: string;
          training_cost_minor: string;
          wage_per_interval_minor: string;
          wage_interval_hours: number;
          ledger_book_id: string;
          accounting_period_id: string;
        }>`SELECT station.airport_id AS base_airport_id, station.id AS station_id, c.catalog_release_id,
          a.reporting_currency, rule.workforce_ruleset_version_id,
          rule.training_lead_hours,
          (rule.hiring_cost_minor ->> a.reporting_currency)::text AS hiring_cost_minor,
          (rule.training_cost_minor ->> a.reporting_currency)::text AS training_cost_minor,
          (rule.wage_per_interval_minor ->> a.reporting_currency)::text AS wage_per_interval_minor,
          rules.wage_interval_hours, book.id AS ledger_book_id, period.id AS accounting_period_id
          FROM airlines a JOIN careers c ON c.id = a.career_id
          JOIN airline_stations station ON station.airline_id = a.id AND station.station_role = 'principal_base'
          JOIN workforce_ruleset_versions rules ON rules.world_ruleset_id = c.world_ruleset_id AND rules.status = 'active'
          JOIN workforce_role_rules rule ON rule.workforce_ruleset_version_id = rules.id AND rule.role = ${input.role}
          JOIN ledger_books book ON book.owner_type = 'airline' AND book.owner_id = a.id
          JOIN accounting_periods period ON period.ledger_book_id = book.id AND period.status = 'open'
          WHERE a.id = ${airlineId}::uuid`.execute(transaction);
        const ctx = context.rows[0];
        if (!ctx)
          throw new WorkforceDomainError(
            "workforce_not_found",
            "Active workforce rules or airline finance state is unavailable.",
          );

        let variantId: string | undefined;
        let variantCode: string | undefined;
        if (input.role === "pilot") {
          if (!input.qualificationAircraftVariantId)
            throw new WorkforceDomainError(
              "invalid_qualification",
              "Pilot hiring requires a catalog aircraft-variant type rating.",
            );
          const variant = await sql<{ id: string; code: string }>`SELECT v.id, v.code
            FROM curated_aircraft_variants v JOIN catalog_release_aircraft_variants m
              ON m.aircraft_variant_id = v.id AND m.release_id = ${ctx.catalog_release_id}::uuid
            WHERE v.id = ${input.qualificationAircraftVariantId}::uuid`.execute(transaction);
          variantId = variant.rows[0]?.id;
          variantCode = variant.rows[0]?.code;
          if (!variantId || !variantCode)
            throw new WorkforceDomainError(
              "invalid_qualification",
              "Pilot type rating must come from the career's published aircraft catalog.",
            );
        } else if (input.qualificationAircraftVariantId) {
          throw new WorkforceDomainError(
            "invalid_qualification",
            `${input.role} uses the general slice-one qualification.`,
          );
        }
        const code = qualificationCode(input.role, variantCode);
        const nextDue = new Date(now.getTime() + ctx.wage_interval_hours * 3_600_000);
        const created = await sql<{ id: string; version: string }>`INSERT INTO workforce_pools
          (airline_id, base_airport_id, role, qualification_code,
           qualification_aircraft_variant_id, catalog_release_id, workforce_ruleset_version_id,
           active_capacity, wage_per_interval_minor, reporting_currency, wage_checkpoint_at,
           next_wage_due_at, created_at, updated_at)
          VALUES (${airlineId}::uuid, ${ctx.base_airport_id}::uuid, ${input.role}, ${code},
            ${variantId ?? null}::uuid, ${variantId ? ctx.catalog_release_id : null}::uuid,
            ${ctx.workforce_ruleset_version_id}::uuid, 0, ${ctx.wage_per_interval_minor}::bigint,
            ${ctx.reporting_currency}, ${now.toISOString()}::timestamptz,
            ${nextDue.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz,
            ${now.toISOString()}::timestamptz)
          ON CONFLICT (airline_id, base_airport_id, role, qualification_code)
          DO UPDATE SET version = workforce_pools.version + 1, updated_at = EXCLUDED.updated_at
          RETURNING id, version::text`.execute(transaction);
        const poolId = created.rows[0]?.id;
        if (!poolId) throw new Error("Workforce pool was not created.");
        await sql`SELECT id FROM workforce_pools WHERE id = ${poolId}::uuid FOR UPDATE`.execute(
          transaction,
        );

        const hiringCost = BigInt(ctx.hiring_cost_minor) * BigInt(input.capacity);
        const trainingCost = BigInt(ctx.training_cost_minor) * BigInt(input.capacity);
        const ledger = new KyselyLedgerRepository(transaction, true);
        const dimensions = { airlineId, stationId: ctx.station_id };
        const hiringJournal = await ledger.post({
          ledgerBookId: ctx.ledger_book_id,
          accountingPeriodId: ctx.accounting_period_id,
          idempotencyKey: `${idempotencyKey}:hiring`,
          commandType: "wages",
          description: `Hire ${input.capacity} ${input.role} workforce capacity`,
          occurredAt: now,
          transactionCurrency: ctx.reporting_currency,
          reportingCurrency: ctx.reporting_currency,
          postings: [
            {
              accountCode: "5100",
              side: "debit",
              transactionAmountMinor: hiringCost,
              reportingAmountMinor: hiringCost,
              dimensions,
            },
            {
              accountCode: "1000",
              side: "credit",
              transactionAmountMinor: hiringCost,
              reportingAmountMinor: hiringCost,
              dimensions,
            },
          ],
        });
        const trainingJournal = await ledger.post({
          ledgerBookId: ctx.ledger_book_id,
          accountingPeriodId: ctx.accounting_period_id,
          idempotencyKey: `${idempotencyKey}:training`,
          commandType: "wages",
          description: `Train ${input.capacity} ${input.role} workforce capacity (${code})`,
          occurredAt: now,
          transactionCurrency: ctx.reporting_currency,
          reportingCurrency: ctx.reporting_currency,
          postings: [
            {
              accountCode: "5100",
              side: "debit",
              transactionAmountMinor: trainingCost,
              reportingAmountMinor: trainingCost,
              dimensions,
            },
            {
              accountCode: "1000",
              side: "credit",
              transactionAmountMinor: trainingCost,
              reportingAmountMinor: trainingCost,
              dimensions,
            },
          ],
        });
        const hireId = randomUUID();
        const availableAt = new Date(now.getTime() + ctx.training_lead_hours * 3_600_000);
        await sql`INSERT INTO workforce_hiring_orders
          (id, workforce_pool_id, airline_id, idempotency_key, capacity, hired_at, available_at,
           wage_checkpoint_at, next_wage_due_at,
           hiring_cost_minor, training_cost_minor, hiring_journal_entry_id,
           training_journal_entry_id, request_hash)
          VALUES (${hireId}::uuid, ${poolId}::uuid, ${airlineId}::uuid, ${idempotencyKey},
            ${input.capacity}, ${now.toISOString()}::timestamptz, ${availableAt.toISOString()}::timestamptz,
            ${availableAt.toISOString()}::timestamptz,
            ${new Date(availableAt.getTime() + ctx.wage_interval_hours * 3_600_000).toISOString()}::timestamptz,
            ${hiringCost.toString()}::bigint, ${trainingCost.toString()}::bigint,
            ${hiringJournal.journalEntryId}::uuid, ${trainingJournal.journalEntryId}::uuid, ${hash})`.execute(
          transaction,
        );
        await sql`INSERT INTO workforce_checkpoint_intents (workforce_pool_id, available_at, intent_type, updated_at)
          VALUES (${poolId}::uuid, ${availableAt.toISOString()}::timestamptz,
            'workforce.checkpoint_due.v1', ${now.toISOString()}::timestamptz)
          ON CONFLICT (workforce_pool_id) DO UPDATE SET
            available_at = LEAST(workforce_checkpoint_intents.available_at, EXCLUDED.available_at),
            updated_at = EXCLUDED.updated_at`.execute(transaction);
        await sql`INSERT INTO outbox_events (aggregate_type, aggregate_id, aggregate_version, event_type, payload, available_at)
          VALUES ('workforce_pool', ${poolId}::uuid, ${created.rows[0]!.version}::bigint, 'workforce.training_due.v1',
            ${JSON.stringify({ workforcePoolId: poolId, hiringOrderId: hireId })}::jsonb,
            ${availableAt.toISOString()}::timestamptz)`.execute(transaction);
        const pool = mapPool(
          (await poolRows(transaction, airlineId)).find((row) => row.id === poolId)!,
        );
        const response: WorkforceHire = {
          id: hireId,
          pool,
          capacity: input.capacity,
          hiredAt: now.toISOString(),
          availableAt: availableAt.toISOString(),
          status: "training",
          hiringCostMinor: hiringCost.toString(),
          trainingCostMinor: trainingCost.toString(),
          hiringJournalEntryId: hiringJournal.journalEntryId,
          trainingJournalEntryId: trainingJournal.journalEntryId,
        };
        await sql`UPDATE idempotency_commands SET state = 'completed', response_status = 201,
          response_body = ${JSON.stringify(response)}::jsonb, updated_at = CURRENT_TIMESTAMP
          WHERE scope = ${scope} AND idempotency_key = ${idempotencyKey}`.execute(transaction);
        return response;
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }

  public async forecast(
    playerAccountId: string,
    airlineId: string,
    through: Date,
    now: Date,
  ): Promise<WorkforceForecast> {
    if (through <= now)
      throw new WorkforceDomainError("invalid_capacity", "Forecast horizon must be in the future.");
    return runInTransaction(this.database, async (transaction) => {
      await assertOwned(transaction, playerAccountId, airlineId);
      await synchronizeDueTraining(transaction, airlineId, now);
      const flights = await sql<FlightRow>`${flightSelect}
        WHERE aircraft.operator_airline_id = ${airlineId}::uuid
          AND df.status IN ('scheduled', 'sold') AND df.departure_at >= ${now.toISOString()}::timestamptz
          AND df.departure_at < ${through.toISOString()}::timestamptz
        ORDER BY df.departure_at, df.id`.execute(transaction);
      return forecastWorkforce(
        flights.rows.map(mapFlight),
        (await poolRows(transaction, airlineId)).map(mapPool),
        now,
        through,
      );
    });
  }

  public async allocateFlight(
    playerAccountId: string,
    airlineId: string,
    flightId: string,
    now: Date,
  ): Promise<WorkforceReadiness> {
    return runInTransaction(
      this.database,
      async (transaction) => {
        await assertOwned(transaction, playerAccountId, airlineId);
        await synchronizeDueTraining(transaction, airlineId, now);
        const flights = await sql<FlightRow>`${flightSelect}
          WHERE aircraft.operator_airline_id = ${airlineId}::uuid AND df.id = ${flightId}::uuid
            AND df.status IN ('scheduled', 'sold') FOR UPDATE OF df`.execute(transaction);
        const flight = flights.rows[0] ? mapFlight(flights.rows[0]) : undefined;
        if (!flight)
          throw new WorkforceDomainError(
            "flight_not_found",
            "Dated flight is unavailable for workforce readiness.",
          );
        const existing = await sql<{
          id: string;
          workforce_pool_id: string;
          role: WorkforceRole;
          qualification_code: string;
          capacity: number;
          duty_starts_at: Date;
          duty_ends_at: Date;
          recovery_ends_at: Date;
        }>`SELECT id, workforce_pool_id, role, qualification_code, capacity, duty_starts_at,
          duty_ends_at, recovery_ends_at FROM workforce_allocations
          WHERE dated_flight_id = ${flightId}::uuid AND status = 'reserved' ORDER BY role`.execute(
          transaction,
        );
        if (existing.rows.length > 0) {
          return {
            flightId,
            ready: true,
            allocations: existing.rows.map((row) => ({
              id: row.id,
              flightId,
              poolId: row.workforce_pool_id,
              role: row.role,
              qualificationCode: row.qualification_code,
              capacity: row.capacity,
              dutyStartsAt: row.duty_starts_at.toISOString(),
              dutyEndsAt: row.duty_ends_at.toISOString(),
              recoveryEndsAt: row.recovery_ends_at.toISOString(),
            })),
            shortages: [],
            formulaVersions: {
              demand: "slice-one-workforce-demand-v1",
              fatigue: "aggregate-duty-recovery-v1",
            },
          };
        }
        const pools = (await poolRows(transaction, airlineId)).map(mapPool);
        const shortages = [] as WorkforceForecast["shortages"] extends readonly (infer T)[]
          ? T[]
          : never[];
        const planned: Array<{
          pool: WorkforcePool;
          role: WorkforceRole;
          capacity: number;
          recovery: string;
        }> = [];
        for (const demand of demandForFlight(flight)) {
          const pool = pools.find(
            (candidate) =>
              candidate.baseAirportId === flight.baseAirportId &&
              candidate.role === demand.role &&
              candidate.qualification.code === demand.qualificationCode,
          );
          if (pool)
            await sql`SELECT id FROM workforce_pools WHERE id = ${pool.id}::uuid FOR UPDATE`.execute(
              transaction,
            );
          const recovery = recoveryEndsAt(flight, demand.role);
          const used = pool
            ? await sql<{ used: string }>`SELECT COALESCE(sum(capacity), 0)::text AS used
                FROM workforce_allocations WHERE workforce_pool_id = ${pool.id}::uuid
                  AND status = 'reserved' AND duty_starts_at < ${recovery}::timestamptz
                  AND recovery_ends_at > ${flight.departureAt}::timestamptz`.execute(transaction)
            : undefined;
          const available = Math.max(
            0,
            (pool?.activeCapacity ?? 0) - Number(used?.rows[0]?.used ?? 0),
          );
          if (available < demand.requiredCapacity) {
            const shortfall = demand.requiredCapacity - available;
            shortages.push({
              flightId,
              flightNumber: flight.flightNumber,
              role: demand.role,
              qualificationCode: demand.qualificationCode,
              baseAirportId: flight.baseAirportId,
              baseIataCode: flight.baseIataCode,
              windowStartsAt: flight.departureAt,
              windowEndsAt: recovery,
              requiredCapacity: demand.requiredCapacity,
              availableCapacity: available,
              shortfall,
              correction: `Hire and complete training for ${shortfall} ${demand.role.replaceAll("_", " ")} capacity at ${flight.baseIataCode}${demand.role === "pilot" ? ` with ${demand.qualificationCode} rating` : ""}, or release an overlapping allocation.`,
            });
          } else if (pool)
            planned.push({ pool, role: demand.role, capacity: demand.requiredCapacity, recovery });
        }
        if (shortages.length)
          throw new WorkforceDomainError(
            "workforce_shortage",
            "Qualified workforce readiness failed; the flight remains undispatched.",
            shortages,
          );
        const allocations: WorkforceAllocation[] = [];
        for (const item of planned) {
          const id = randomUUID();
          await sql`INSERT INTO workforce_allocations
            (id, dated_flight_id, workforce_pool_id, role, qualification_code, capacity,
             duty_starts_at, duty_ends_at, recovery_ends_at, allocated_at)
            VALUES (${id}::uuid, ${flightId}::uuid, ${item.pool.id}::uuid, ${item.role},
              ${item.pool.qualification.code}, ${item.capacity}, ${flight.departureAt}::timestamptz,
              ${flight.arrivalAt}::timestamptz, ${item.recovery}::timestamptz,
              ${now.toISOString()}::timestamptz)`.execute(transaction);
          allocations.push({
            id,
            flightId,
            poolId: item.pool.id,
            role: item.role,
            qualificationCode: item.pool.qualification.code,
            capacity: item.capacity,
            dutyStartsAt: flight.departureAt,
            dutyEndsAt: flight.arrivalAt,
            recoveryEndsAt: item.recovery,
          });
        }
        return {
          flightId,
          ready: true,
          allocations,
          shortages: [],
          formulaVersions: {
            demand: "slice-one-workforce-demand-v1",
            fatigue: "aggregate-duty-recovery-v1",
          },
        };
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }

  public async accrueWages(
    playerAccountId: string,
    airlineId: string,
    through: Date,
    idempotencyKey: string,
    now: Date,
  ): Promise<readonly WorkforceWageAccrual[]> {
    return runInTransaction(
      this.database,
      async (transaction) => {
        await assertOwned(transaction, playerAccountId, airlineId);
        await synchronizeDueTraining(transaction, airlineId, now);
        const finance = await sql<{
          ledger_book_id: string;
          accounting_period_id: string;
          reporting_currency: CurrencyCode;
        }>`
          SELECT book.id AS ledger_book_id, period.id AS accounting_period_id, book.reporting_currency
          FROM ledger_books book JOIN accounting_periods period ON period.ledger_book_id = book.id AND period.status = 'open'
          WHERE book.owner_type = 'airline' AND book.owner_id = ${airlineId}::uuid`.execute(
          transaction,
        );
        const context = finance.rows[0];
        if (!context)
          throw new WorkforceDomainError(
            "workforce_not_found",
            "Airline finance state is unavailable for wages.",
          );
        const cohorts = await sql<
          PoolRow & {
            hiring_order_id: string;
            cohort_capacity: number;
            wage_interval_hours: number;
          }
        >`SELECT p.id, p.airline_id,
          p.base_airport_id, airport.iata_code AS base_iata_code, p.role, p.qualification_code,
          p.qualification_aircraft_variant_id, p.catalog_release_id, p.active_capacity,
          '0'::text AS pending_capacity, NULL::timestamptz AS next_available_at,
          p.wage_per_interval_minor::text, p.reporting_currency, h.wage_checkpoint_at,
          h.next_wage_due_at, p.version::text, h.id AS hiring_order_id,
          h.capacity AS cohort_capacity, rules.wage_interval_hours
          FROM workforce_pools p JOIN curated_airports airport ON airport.id = p.base_airport_id
          JOIN workforce_ruleset_versions rules ON rules.id = p.workforce_ruleset_version_id
          JOIN workforce_hiring_orders h ON h.workforce_pool_id = p.id AND h.status = 'available'
          WHERE p.airline_id = ${airlineId}::uuid ORDER BY p.id, h.available_at, h.id
          FOR UPDATE OF p, h`.execute(transaction);
        const ledger = new KyselyLedgerRepository(transaction, true);
        const result: WorkforceWageAccrual[] = [];
        const touchedPools = new Set<string>();
        for (const row of cohorts.rows) {
          const intervalMs = row.wage_interval_hours * 3_600_000;
          const intervals = Math.floor(
            (through.getTime() - row.wage_checkpoint_at.getTime()) / intervalMs,
          );
          if (intervals <= 0) continue;
          const intervalEndsAt = new Date(
            row.wage_checkpoint_at.getTime() + intervals * intervalMs,
          );
          const amount =
            BigInt(row.wage_per_interval_minor) * BigInt(row.cohort_capacity) * BigInt(intervals);
          const posted = await ledger.post({
            ledgerBookId: context.ledger_book_id,
            accountingPeriodId: context.accounting_period_id,
            idempotencyKey: `${idempotencyKey}:${row.hiring_order_id}:${intervalEndsAt.toISOString()}`,
            commandType: "wages",
            description: `${intervals} workforce wage interval(s) for ${row.role} (${row.qualification_code})`,
            occurredAt: intervalEndsAt,
            transactionCurrency: context.reporting_currency,
            reportingCurrency: context.reporting_currency,
            postings: [
              {
                accountCode: "5100",
                side: "debit",
                transactionAmountMinor: amount,
                reportingAmountMinor: amount,
                dimensions: { airlineId },
              },
              {
                accountCode: "1000",
                side: "credit",
                transactionAmountMinor: amount,
                reportingAmountMinor: amount,
                dimensions: { airlineId },
              },
            ],
          });
          await sql`INSERT INTO workforce_wage_accruals
            (workforce_pool_id, workforce_hiring_order_id, interval_starts_at, interval_ends_at, capacity, amount_minor,
             journal_entry_id, accrued_at)
            VALUES (${row.id}::uuid, ${row.hiring_order_id}::uuid,
              ${row.wage_checkpoint_at.toISOString()}::timestamptz,
              ${intervalEndsAt.toISOString()}::timestamptz, ${row.cohort_capacity}, ${amount.toString()}::bigint,
              ${posted.journalEntryId}::uuid, ${now.toISOString()}::timestamptz)
            ON CONFLICT (workforce_hiring_order_id, interval_starts_at, interval_ends_at) DO NOTHING`.execute(
            transaction,
          );
          await sql`UPDATE workforce_hiring_orders SET wage_checkpoint_at = ${intervalEndsAt.toISOString()}::timestamptz,
            next_wage_due_at = ${new Date(intervalEndsAt.getTime() + intervalMs).toISOString()}::timestamptz
            WHERE id = ${row.hiring_order_id}::uuid`.execute(transaction);
          touchedPools.add(row.id);
          result.push({
            poolId: row.id,
            intervalStartsAt: row.wage_checkpoint_at.toISOString(),
            intervalEndsAt: intervalEndsAt.toISOString(),
            capacity: row.cohort_capacity,
            amountMinor: amount.toString(),
            journalEntryId: posted.journalEntryId,
          });
        }
        for (const poolId of touchedPools) {
          await sql`UPDATE workforce_pools p SET
            wage_checkpoint_at = (SELECT min(h.wage_checkpoint_at) FROM workforce_hiring_orders h
              WHERE h.workforce_pool_id = p.id AND h.status = 'available'),
            next_wage_due_at = (SELECT min(h.next_wage_due_at) FROM workforce_hiring_orders h
              WHERE h.workforce_pool_id = p.id AND h.status = 'available'),
            version = version + 1, updated_at = ${now.toISOString()}::timestamptz
            WHERE id = ${poolId}::uuid`.execute(transaction);
          await sql`INSERT INTO workforce_checkpoint_intents (workforce_pool_id, available_at, intent_type, updated_at)
            SELECT p.id, LEAST(
              COALESCE((SELECT min(h.available_at) FROM workforce_hiring_orders h
                WHERE h.workforce_pool_id = p.id AND h.status = 'training'), 'infinity'::timestamptz),
              COALESCE((SELECT min(h.next_wage_due_at) FROM workforce_hiring_orders h
                WHERE h.workforce_pool_id = p.id AND h.status = 'available'), 'infinity'::timestamptz)),
              'workforce.checkpoint_due.v1', ${now.toISOString()}::timestamptz
            FROM workforce_pools p WHERE p.id = ${poolId}::uuid
            ON CONFLICT (workforce_pool_id) DO UPDATE SET available_at = EXCLUDED.available_at,
              updated_at = EXCLUDED.updated_at`.execute(transaction);
        }
        return result;
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }
}
