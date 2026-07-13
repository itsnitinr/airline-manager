import { createHash, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import type {
  CurrencyCode,
  DeterministicFault,
  FlightCompletionUtilizationInput,
  FlightCompletionUtilizationResult,
  MaintenanceCounterSnapshot,
  MaintenanceDueAssessment,
  MaintenanceForecast,
  MaintenanceHistoryEvent,
  MaintenanceProgram,
  MaintenanceRepository,
  MaintenanceRule,
  MaintenanceWindowInput,
  MaintenanceWorkPackage,
} from "@airline-manager/domain";
import {
  MaintenanceDomainError,
  assessMaintenanceDue,
  conditionAfterUtilization,
  deterministicFault,
} from "@airline-manager/domain";
import type { Database } from "../database.js";
import type { DB } from "../generated/database.js";
import { KyselyLedgerRepository } from "../finance/repository.js";
import { runInTransaction } from "../transactions.js";

type Queryable = Database | Transaction<DB>;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type Context = Readonly<{
  aircraft_id: string;
  airline_id: string;
  aircraft_variant_id: string;
  aircraft_variant_code: string;
  accumulated_hours_minutes: string;
  accumulated_cycles: string;
  condition_basis_points: number;
  dispatch_reliability_basis_points: number;
  aircraft_version: string;
  base_airport_id: string;
  base_iata_code: string;
  reporting_currency: CurrencyCode;
  ledger_book_id: string;
  accounting_period_id: string;
  maintenance_program_version_id: string;
  maintenance_program_version: string;
  utilization_formula_version: string;
  condition_formula_version: string;
  fault_formula_version: string;
  calendar_semantics: "elapsed_utc_days";
}>;

type RuleRow = Readonly<{
  id: string;
  code: string;
  name: string;
  work_kind: "line" | "package";
  interval_hours_minutes: string | null;
  interval_cycles: string | null;
  interval_calendar_days: number | null;
  hard_limit: boolean;
  maximum_deferral_hours_minutes: string;
  maximum_deferral_cycles: string;
  maximum_deferral_calendar_days: number;
  duration_minutes: number;
  workforce_capacity: number;
  cost_minor: Record<string, string>;
  condition_restore_basis_points: number;
}>;

type CounterRow = Readonly<{
  maintenance_rule_id: string;
  baseline_hours_minutes: string;
  baseline_cycles: string;
  calendar_started_at: Date;
  due_state: MaintenanceDueAssessment["state"];
}>;

async function loadContext(
  database: Queryable,
  playerAccountId: string,
  airlineId: string,
  aircraftId: string,
): Promise<Context> {
  const result =
    await sql<Context>`SELECT ac.id AS aircraft_id, ac.operator_airline_id AS airline_id,
    ac.aircraft_variant_id, variant.code AS aircraft_variant_code,
    ac.accumulated_hours_minutes::text, ac.accumulated_cycles::text,
    ac.condition_basis_points, ac.dispatch_reliability_basis_points, ac.version::text AS aircraft_version,
    station.airport_id AS base_airport_id, airport.iata_code AS base_iata_code,
    airline.reporting_currency, book.id AS ledger_book_id, period.id AS accounting_period_id,
    program.id AS maintenance_program_version_id, program.version AS maintenance_program_version,
    program.utilization_formula_version, program.condition_formula_version,
    program.fault_formula_version, program.calendar_semantics
    FROM aircraft ac
    JOIN curated_aircraft_variants variant ON variant.id = ac.aircraft_variant_id
    JOIN airlines airline ON airline.id = ac.operator_airline_id AND airline.status = 'active'
    JOIN careers career ON career.id = airline.career_id
    JOIN maintenance_program_versions program ON program.world_ruleset_id = career.world_ruleset_id
      AND program.status = 'active'
    JOIN airline_stations station ON station.airline_id = airline.id AND station.station_role = 'principal_base'
    JOIN curated_airports airport ON airport.id = station.airport_id
    JOIN ledger_books book ON book.owner_type = 'airline' AND book.owner_id = airline.id
    JOIN accounting_periods period ON period.ledger_book_id = book.id AND period.status = 'open'
    JOIN resource_ownerships own ON own.resource_type = 'airline' AND own.resource_id = airline.id
      AND own.player_account_id = ${playerAccountId}::uuid
    WHERE ac.id = ${aircraftId}::uuid AND ac.operator_airline_id = ${airlineId}::uuid
      AND ac.delivery_state = 'delivered'`.execute(database);
  const row = result.rows[0];
  if (!row)
    throw new MaintenanceDomainError(
      "aircraft_not_found",
      "Delivered aircraft maintenance state is unavailable.",
    );
  return row;
}

async function loadRules(database: Queryable, context: Context): Promise<readonly RuleRow[]> {
  const result = await sql<RuleRow>`SELECT id, code, name, work_kind,
    interval_hours_minutes::text, interval_cycles::text, interval_calendar_days, hard_limit,
    maximum_deferral_hours_minutes::text, maximum_deferral_cycles::text,
    maximum_deferral_calendar_days, duration_minutes, workforce_capacity, cost_minor,
    condition_restore_basis_points
    FROM maintenance_program_rules
    WHERE maintenance_program_version_id = ${context.maintenance_program_version_id}::uuid
      AND aircraft_variant_id = ${context.aircraft_variant_id}::uuid
    ORDER BY code`.execute(database);
  if (result.rows.length === 0)
    throw new MaintenanceDomainError(
      "maintenance_not_found",
      "The aircraft variant has no active maintenance program.",
    );
  return result.rows;
}

function mapRule(row: RuleRow, currency: CurrencyCode): MaintenanceRule {
  const cost = row.cost_minor[currency];
  if (cost === undefined)
    throw new MaintenanceDomainError(
      "maintenance_not_found",
      `Maintenance cost is unavailable in ${currency}.`,
    );
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.work_kind,
    ...(row.interval_hours_minutes === null
      ? {}
      : { intervalHoursMinutes: row.interval_hours_minutes }),
    ...(row.interval_cycles === null ? {} : { intervalCycles: row.interval_cycles }),
    ...(row.interval_calendar_days === null
      ? {}
      : { intervalCalendarDays: row.interval_calendar_days }),
    hardLimit: row.hard_limit,
    maximumDeferralHoursMinutes: row.maximum_deferral_hours_minutes,
    maximumDeferralCycles: row.maximum_deferral_cycles,
    maximumDeferralCalendarDays: row.maximum_deferral_calendar_days,
    durationMinutes: row.duration_minutes,
    workforceCapacity: row.workforce_capacity,
    costMinor: cost,
    conditionRestoreBasisPoints: row.condition_restore_basis_points,
  };
}

async function nextHistorySequence(database: Queryable, aircraftId: string): Promise<bigint> {
  const result = await sql<{
    sequence: string;
  }>`SELECT (COALESCE(max(sequence), 0) + 1)::text AS sequence
    FROM maintenance_history WHERE aircraft_id = ${aircraftId}::uuid`.execute(database);
  return BigInt(result.rows[0]?.sequence ?? "1");
}

async function appendHistory(
  database: Queryable,
  aircraftId: string,
  eventType: string,
  occurredAt: Date,
  details: unknown,
  journalEntryId?: string,
): Promise<void> {
  await sql`INSERT INTO maintenance_history
    (aircraft_id, sequence, event_type, occurred_at, details, journal_entry_id)
    VALUES (${aircraftId}::uuid, ${(await nextHistorySequence(database, aircraftId)).toString()}::bigint,
      ${eventType}, ${occurredAt.toISOString()}::timestamptz, ${JSON.stringify(details)}::jsonb,
      ${journalEntryId ?? null}::uuid)`.execute(database);
}

async function ensureAssignment(
  transaction: Transaction<DB>,
  context: Context,
  rules: readonly RuleRow[],
  now: Date,
): Promise<void> {
  const inserted = await sql<{ aircraft_id: string }>`INSERT INTO aircraft_maintenance_assignments
    (aircraft_id, maintenance_program_version_id, aircraft_variant_id, assigned_at,
     starting_hours_minutes, starting_cycles, program_snapshot)
    VALUES (${context.aircraft_id}::uuid, ${context.maintenance_program_version_id}::uuid,
      ${context.aircraft_variant_id}::uuid, ${now.toISOString()}::timestamptz,
      ${context.accumulated_hours_minutes}::bigint, ${context.accumulated_cycles}::bigint,
      ${JSON.stringify({
        version: context.maintenance_program_version,
        aircraftVariantCode: context.aircraft_variant_code,
        utilizationFormulaVersion: context.utilization_formula_version,
        conditionFormulaVersion: context.condition_formula_version,
        faultFormulaVersion: context.fault_formula_version,
        calendarSemantics: context.calendar_semantics,
      })}::jsonb)
    ON CONFLICT (aircraft_id) DO NOTHING RETURNING aircraft_id`.execute(transaction);
  if (inserted.rows.length === 0) return;
  for (const rule of rules)
    await sql`INSERT INTO aircraft_maintenance_due_counters
      (aircraft_id, maintenance_rule_id, baseline_hours_minutes, baseline_cycles,
       calendar_started_at, due_state, assessed_at)
      VALUES (${context.aircraft_id}::uuid, ${rule.id}::uuid,
        ${context.accumulated_hours_minutes}::bigint, ${context.accumulated_cycles}::bigint,
        ${now.toISOString()}::timestamptz, 'not_due', ${now.toISOString()}::timestamptz)`.execute(
      transaction,
    );
  await appendHistory(transaction, context.aircraft_id, "program_assigned", now, {
    programVersion: context.maintenance_program_version,
    aircraftVariantCode: context.aircraft_variant_code,
  });
  const calendarDays = rules
    .map((rule) => rule.interval_calendar_days)
    .filter((value): value is number => value !== null);
  const nextAt = new Date(
    now.getTime() + (calendarDays.length ? Math.min(...calendarDays) : 1) * 86_400_000,
  );
  await sql`INSERT INTO maintenance_checkpoint_intents (aircraft_id, available_at, intent_type, updated_at)
    VALUES (${context.aircraft_id}::uuid, ${nextAt.toISOString()}::timestamptz,
      'maintenance.checkpoint_due.v1', ${now.toISOString()}::timestamptz)
    ON CONFLICT (aircraft_id) DO NOTHING`.execute(transaction);
}

async function assess(
  database: Queryable,
  context: Context,
  rules: readonly RuleRow[],
  now: Date,
  persist: boolean,
): Promise<readonly MaintenanceDueAssessment[]> {
  const counters = await sql<CounterRow>`SELECT maintenance_rule_id, baseline_hours_minutes::text,
    baseline_cycles::text, calendar_started_at, due_state
    FROM aircraft_maintenance_due_counters WHERE aircraft_id = ${context.aircraft_id}::uuid`.execute(
    database,
  );
  const byRule = new Map(counters.rows.map((counter) => [counter.maintenance_rule_id, counter]));
  const current: MaintenanceCounterSnapshot = {
    accumulatedHoursMinutes: BigInt(context.accumulated_hours_minutes),
    accumulatedCycles: BigInt(context.accumulated_cycles),
    calendarStartedAt: now,
    measuredAt: now,
  };
  const assessments: MaintenanceDueAssessment[] = [];
  for (const row of rules) {
    const counter = byRule.get(row.id);
    if (!counter) continue;
    const assessment = assessMaintenanceDue(
      mapRule(row, context.reporting_currency),
      {
        accumulatedHoursMinutes: BigInt(counter.baseline_hours_minutes),
        accumulatedCycles: BigInt(counter.baseline_cycles),
        calendarStartedAt: counter.calendar_started_at,
        measuredAt: now,
      },
      current,
    );
    assessments.push(assessment);
    if (persist && counter.due_state !== assessment.state)
      await sql`UPDATE aircraft_maintenance_due_counters SET due_state = ${assessment.state},
        assessed_at = ${now.toISOString()}::timestamptz, version = version + 1
        WHERE aircraft_id = ${context.aircraft_id}::uuid AND maintenance_rule_id = ${row.id}::uuid`.execute(
        database,
      );
  }
  return assessments;
}

function programFrom(context: Context, rules: readonly RuleRow[]): MaintenanceProgram {
  return {
    id: context.maintenance_program_version_id,
    version: context.maintenance_program_version,
    aircraftVariantId: context.aircraft_variant_id,
    aircraftVariantCode: context.aircraft_variant_code,
    utilizationFormulaVersion: context.utilization_formula_version,
    conditionFormulaVersion: context.condition_formula_version,
    faultFormulaVersion: context.fault_formula_version,
    calendarSemantics: context.calendar_semantics,
    rules: rules.map((rule) => mapRule(rule, context.reporting_currency)),
  };
}

type PackageRow = Readonly<{
  id: string;
  aircraft_id: string;
  source: "planned" | "repair";
  rule_code: string | null;
  maintenance_fault_id: string | null;
  status: "planned" | "completed";
  starts_at: Date;
  ends_at: Date;
  airport_id: string;
  workforce_capacity: number;
  cost_minor: string;
  program_version: string;
  journal_entry_id: string | null;
}>;

const packageSelect = sql<PackageRow>`SELECT package.id, package.aircraft_id, package.source,
  rule.code AS rule_code, package.maintenance_fault_id, package.status, maintenance_window.starts_at,
  maintenance_window.ends_at, maintenance_window.airport_id, package.workforce_capacity, package.cost_minor::text,
  package.program_version, package.journal_entry_id
  FROM maintenance_work_packages package
  JOIN maintenance_windows maintenance_window ON maintenance_window.maintenance_work_package_id = package.id
  LEFT JOIN maintenance_program_rules rule ON rule.id = package.maintenance_rule_id`;

function mapPackage(row: PackageRow): MaintenanceWorkPackage {
  return {
    id: row.id,
    aircraftId: row.aircraft_id,
    source: row.source,
    ...(row.rule_code ? { ruleCode: row.rule_code } : {}),
    ...(row.maintenance_fault_id ? { faultId: row.maintenance_fault_id } : {}),
    status: row.status,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    airportId: row.airport_id,
    workforceCapacity: row.workforce_capacity,
    costMinor: row.cost_minor,
    programVersion: row.program_version,
    ...(row.journal_entry_id ? { journalEntryId: row.journal_entry_id } : {}),
  };
}

function mapConstraint(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "23P01")
    throw new MaintenanceDomainError(
      "occupancy_conflict",
      "The maintenance window overlaps aircraft occupancy.",
      [
        "Move the maintenance window outside every scheduled flight, turnaround, or other maintenance window.",
      ],
    );
  throw error;
}

export class KyselyMaintenanceRepository implements MaintenanceRepository {
  public constructor(private readonly database: Database) {}

  public async program(
    playerAccountId: string,
    airlineId: string,
    aircraftId: string,
    now: Date,
  ): Promise<MaintenanceProgram> {
    return runInTransaction(this.database, async (transaction) => {
      const context = await loadContext(transaction, playerAccountId, airlineId, aircraftId);
      const rules = await loadRules(transaction, context);
      await sql`SELECT id FROM aircraft WHERE id = ${aircraftId}::uuid FOR UPDATE`.execute(
        transaction,
      );
      await ensureAssignment(transaction, context, rules, now);
      return programFrom(context, rules);
    });
  }

  public async recordFlightCompletion(
    playerAccountId: string,
    airlineId: string,
    input: FlightCompletionUtilizationInput,
    now: Date,
  ): Promise<FlightCompletionUtilizationResult> {
    if (
      !input.completionKey ||
      !input.faultSeed ||
      !Number.isSafeInteger(input.blockMinutes) ||
      input.blockMinutes < 1 ||
      input.blockMinutes > 1_440 ||
      !Number.isSafeInteger(input.cycles) ||
      input.cycles < 1 ||
      input.cycles > 10 ||
      !Number.isFinite(Date.parse(input.completedAt))
    )
      throw new MaintenanceDomainError(
        "invalid_utilization",
        "Flight completion requires a stable key, valid UTC completion time, 1-1440 block minutes, 1-10 cycles, and a persisted fault seed.",
      );
    const inputHash = hash({ airlineId, ...input });
    return runInTransaction(
      this.database,
      async (transaction) => {
        let context = await loadContext(transaction, playerAccountId, airlineId, input.aircraftId);
        await sql`SELECT id FROM aircraft WHERE id = ${input.aircraftId}::uuid FOR UPDATE`.execute(
          transaction,
        );
        const existing = await sql<{
          input_hash: string;
          aircraft_id: string;
          result_snapshot: FlightCompletionUtilizationResult;
        }>`
          SELECT input_hash, aircraft_id, result_snapshot FROM flight_completion_utilization_inputs
          WHERE completion_key = ${input.completionKey} FOR UPDATE`.execute(transaction);
        if (existing.rows[0]) {
          if (
            existing.rows[0].aircraft_id !== input.aircraftId ||
            existing.rows[0].input_hash.trim() !== inputHash
          )
            throw new MaintenanceDomainError(
              "idempotency_conflict",
              "Completion key was reused with different utilization input.",
            );
          return existing.rows[0].result_snapshot;
        }
        const rules = await loadRules(transaction, context);
        await ensureAssignment(transaction, context, rules, now);
        const nextHours = BigInt(context.accumulated_hours_minutes) + BigInt(input.blockMinutes);
        const nextCycles = BigInt(context.accumulated_cycles) + BigInt(input.cycles);
        context = {
          ...context,
          accumulated_hours_minutes: nextHours.toString(),
          accumulated_cycles: nextCycles.toString(),
        };
        const due = await assess(transaction, context, rules, new Date(input.completedAt), true);
        const condition = conditionAfterUtilization(
          context.condition_basis_points,
          BigInt(input.blockMinutes),
          BigInt(input.cycles),
          due,
        );
        const snapshot = {
          aircraftId: input.aircraftId,
          completionKey: input.completionKey,
          programVersion: context.maintenance_program_version,
          conditionBasisPoints: condition.conditionBasisPoints,
          dispatchReliabilityBasisPoints: condition.dispatchReliabilityBasisPoints,
          accumulatedHoursMinutes: nextHours.toString(),
          accumulatedCycles: nextCycles.toString(),
        };
        const fault = deterministicFault(input.faultSeed, snapshot);
        const faultId = fault.outcome === "none" ? undefined : randomUUID();
        const result: FlightCompletionUtilizationResult = {
          completionKey: input.completionKey,
          aircraftId: input.aircraftId,
          accumulatedHoursMinutes: nextHours.toString(),
          accumulatedCycles: nextCycles.toString(),
          conditionBasisPoints: condition.conditionBasisPoints,
          dispatchReliabilityBasisPoints: condition.dispatchReliabilityBasisPoints,
          programVersion: context.maintenance_program_version,
          fault: { ...fault, ...(faultId ? { id: faultId } : {}) },
          processedAt: now.toISOString(),
        };
        const utilizationId = randomUUID();
        await sql`INSERT INTO flight_completion_utilization_inputs
          (id, completion_key, aircraft_id, input_hash, completed_at, block_minutes, cycles,
           fault_seed, program_version, material_input_snapshot, result_snapshot, processed_at)
          VALUES (${utilizationId}::uuid, ${input.completionKey}, ${input.aircraftId}::uuid,
            ${inputHash}, ${input.completedAt}::timestamptz, ${input.blockMinutes}, ${input.cycles},
            ${input.faultSeed}, ${context.maintenance_program_version}, ${JSON.stringify(snapshot)}::jsonb,
            ${JSON.stringify(result)}::jsonb, ${now.toISOString()}::timestamptz)`.execute(
          transaction,
        );
        if (faultId) {
          const cheapest = rules
            .map((rule) => BigInt(mapRule(rule, context.reporting_currency).costMinor))
            .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))[0]!;
          const repairCost = (cheapest * BigInt(fault.repairCostMultiplierBasisPoints)) / 10_000n;
          await sql`INSERT INTO maintenance_faults
            (id, flight_completion_utilization_input_id, aircraft_id, status, outcome, severity,
             delay_minutes, grounds_aircraft, repair_duration_minutes, repair_workforce_capacity,
             repair_cost_minor, deterministic_seed, input_snapshot, outcome_snapshot, discovered_at)
            VALUES (${faultId}::uuid, ${utilizationId}::uuid, ${input.aircraftId}::uuid, 'open',
              ${fault.outcome}, ${fault.severity}, ${fault.delayMinutes}, ${fault.groundsAircraft},
              ${fault.repairDurationMinutes}, ${fault.repairWorkforceCapacity},
              ${repairCost.toString()}::bigint, ${input.faultSeed}, ${JSON.stringify(snapshot)}::jsonb,
              ${JSON.stringify(fault)}::jsonb, ${input.completedAt}::timestamptz)`.execute(
            transaction,
          );
        }
        await sql`UPDATE aircraft SET accumulated_hours_minutes = ${nextHours.toString()}::bigint,
          accumulated_cycles = ${nextCycles.toString()}::bigint,
          condition_basis_points = ${condition.conditionBasisPoints},
          dispatch_reliability_basis_points = ${condition.dispatchReliabilityBasisPoints},
          version = version + 1 WHERE id = ${input.aircraftId}::uuid`.execute(transaction);
        await appendHistory(
          transaction,
          input.aircraftId,
          "utilization_recorded",
          new Date(input.completedAt),
          {
            completionKey: input.completionKey,
            blockMinutes: input.blockMinutes,
            cycles: input.cycles,
            programVersion: context.maintenance_program_version,
          },
        );
        if (faultId)
          await appendHistory(
            transaction,
            input.aircraftId,
            "fault_discovered",
            new Date(input.completedAt),
            {
              faultId,
              seed: input.faultSeed,
              inputSnapshot: snapshot,
              outcome: fault,
            },
          );
        await sql`INSERT INTO outbox_events
          (aggregate_type, aggregate_id, aggregate_version, event_type, payload, available_at)
          VALUES ('aircraft', ${input.aircraftId}::uuid, ${(BigInt(context.aircraft_version) + 1n).toString()}::bigint,
            'maintenance.utilization_recorded.v1',
            ${JSON.stringify({ aircraftId: input.aircraftId, completionKey: input.completionKey })}::jsonb,
            ${now.toISOString()}::timestamptz)`.execute(transaction);
        if (due.some((assessment) => assessment.state !== "not_due")) {
          await sql`INSERT INTO outbox_events
            (aggregate_type, aggregate_id, aggregate_version, event_type, payload, available_at)
            VALUES ('aircraft', ${input.aircraftId}::uuid, ${(BigInt(context.aircraft_version) + 1n).toString()}::bigint,
              'maintenance.due.v1',
              ${JSON.stringify({ aircraftId: input.aircraftId, due: due.filter((assessment) => assessment.state !== "not_due") })}::jsonb,
              ${now.toISOString()}::timestamptz)`.execute(transaction);
        }
        if (faultId) {
          await sql`INSERT INTO outbox_events
            (aggregate_type, aggregate_id, aggregate_version, event_type, payload, available_at)
            VALUES ('aircraft', ${input.aircraftId}::uuid, ${(BigInt(context.aircraft_version) + 1n).toString()}::bigint,
              'maintenance.fault_discovered.v1',
              ${JSON.stringify({ aircraftId: input.aircraftId, faultId, severity: fault.severity, groundsAircraft: fault.groundsAircraft })}::jsonb,
              ${now.toISOString()}::timestamptz)`.execute(transaction);
        }
        return result;
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }

  public async scheduleWork(
    playerAccountId: string,
    airlineId: string,
    aircraftId: string,
    input: MaintenanceWindowInput,
    idempotencyKey: string,
    now: Date,
  ): Promise<MaintenanceWorkPackage> {
    const startsAt = new Date(input.startsAt);
    if (
      !Number.isFinite(startsAt.getTime()) ||
      startsAt <= now ||
      Number(Boolean(input.ruleCode)) + Number(Boolean(input.faultId)) !== 1
    )
      throw new MaintenanceDomainError(
        "invalid_window",
        "Choose exactly one maintenance rule or open fault and a future UTC start time.",
      );
    const requestHash = hash({ airlineId, aircraftId, ...input });
    return runInTransaction(
      this.database,
      async (transaction) => {
        const context = await loadContext(transaction, playerAccountId, airlineId, aircraftId);
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${aircraftId}, 14))`.execute(
          transaction,
        );
        await sql`SELECT id FROM aircraft WHERE id = ${aircraftId}::uuid FOR UPDATE`.execute(
          transaction,
        );
        const existing = await sql<PackageRow>`${packageSelect}
          WHERE package.aircraft_id = ${aircraftId}::uuid AND package.idempotency_key = ${idempotencyKey}`.execute(
          transaction,
        );
        if (existing.rows[0]) {
          const stored = await sql<{
            request_hash: string;
          }>`SELECT request_hash FROM maintenance_work_packages
            WHERE id = ${existing.rows[0].id}::uuid`.execute(transaction);
          if (stored.rows[0]?.request_hash.trim() !== requestHash)
            throw new MaintenanceDomainError(
              "idempotency_conflict",
              "Idempotency key was reused with a different maintenance window.",
            );
          return mapPackage(existing.rows[0]);
        }
        const rules = await loadRules(transaction, context);
        await ensureAssignment(transaction, context, rules, now);
        let source: "planned" | "repair";
        let durationMinutes: number;
        let workforceCapacity: number;
        let costMinor: bigint;
        let rule: RuleRow | undefined;
        let fault:
          | Readonly<{
              id: string;
              status: string;
              repair_duration_minutes: number;
              repair_workforce_capacity: number;
              repair_cost_minor: string;
              outcome_snapshot: DeterministicFault;
            }>
          | undefined;
        if (input.ruleCode) {
          source = "planned";
          rule = rules.find((candidate) => candidate.code === input.ruleCode);
          if (!rule)
            throw new MaintenanceDomainError("rule_not_found", "Maintenance rule is unavailable.");
          const mapped = mapRule(rule, context.reporting_currency);
          durationMinutes = mapped.durationMinutes;
          workforceCapacity = mapped.workforceCapacity;
          costMinor = BigInt(mapped.costMinor);
        } else {
          source = "repair";
          const found = await sql<typeof fault extends Readonly<infer T> | undefined ? T : never>`
            SELECT id, status, repair_duration_minutes, repair_workforce_capacity,
              repair_cost_minor::text, outcome_snapshot FROM maintenance_faults
            WHERE id = ${input.faultId!}::uuid AND aircraft_id = ${aircraftId}::uuid FOR UPDATE`.execute(
            transaction,
          );
          fault = found.rows[0];
          if (!fault || fault.status !== "open")
            throw new MaintenanceDomainError(
              "fault_not_found",
              "Open maintenance fault is unavailable.",
            );
          durationMinutes = fault.repair_duration_minutes;
          workforceCapacity = fault.repair_workforce_capacity;
          costMinor = BigInt(fault.repair_cost_minor);
        }
        const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
        const pool = await sql<{ id: string; active_capacity: number }>`SELECT id, active_capacity
          FROM workforce_pools WHERE airline_id = ${airlineId}::uuid
            AND base_airport_id = ${context.base_airport_id}::uuid
            AND role = 'line_maintenance' AND qualification_code = 'general'
          FOR UPDATE`.execute(transaction);
        const workforcePool = pool.rows[0];
        const used = workforcePool
          ? await sql<{ used: string }>`SELECT COALESCE(sum(capacity), 0)::text AS used FROM (
              SELECT capacity FROM workforce_allocations WHERE workforce_pool_id = ${workforcePool.id}::uuid
                AND status = 'reserved' AND duty_starts_at < ${endsAt.toISOString()}::timestamptz
                AND recovery_ends_at > ${startsAt.toISOString()}::timestamptz
              UNION ALL
              SELECT capacity FROM maintenance_workforce_allocations WHERE workforce_pool_id = ${workforcePool.id}::uuid
                AND status = 'reserved' AND duty_starts_at < ${endsAt.toISOString()}::timestamptz
                AND duty_ends_at > ${startsAt.toISOString()}::timestamptz
            ) occupied`.execute(transaction)
          : undefined;
        const available = Math.max(
          0,
          (workforcePool?.active_capacity ?? 0) - Number(used?.rows[0]?.used ?? 0),
        );
        if (!workforcePool || available < workforceCapacity)
          throw new MaintenanceDomainError(
            "workforce_shortage",
            "Qualified line-maintenance capacity is unavailable for the requested window.",
            [
              `Required ${workforceCapacity}, available ${available} at ${context.base_iata_code}. Hire capacity or move the window outside overlapping allocations.`,
            ],
          );
        const packageId = randomUUID();
        await sql`INSERT INTO maintenance_work_packages
          (id, aircraft_id, maintenance_rule_id, maintenance_fault_id, source, status,
           program_version, rule_snapshot, workforce_capacity, cost_minor, idempotency_key,
           request_hash, created_at)
          VALUES (${packageId}::uuid, ${aircraftId}::uuid, ${rule?.id ?? null}::uuid,
            ${fault?.id ?? null}::uuid, ${source}, 'planned', ${context.maintenance_program_version},
            ${JSON.stringify(rule ?? fault?.outcome_snapshot ?? {})}::jsonb, ${workforceCapacity},
            ${costMinor.toString()}::bigint, ${idempotencyKey}, ${requestHash},
            ${now.toISOString()}::timestamptz)`.execute(transaction);
        await sql`INSERT INTO maintenance_windows
          (maintenance_work_package_id, aircraft_id, airport_id, starts_at, ends_at, status, created_at)
          VALUES (${packageId}::uuid, ${aircraftId}::uuid, ${context.base_airport_id}::uuid,
            ${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz,
            'scheduled', ${now.toISOString()}::timestamptz)`.execute(transaction);
        await sql`INSERT INTO maintenance_workforce_allocations
          (maintenance_work_package_id, workforce_pool_id, capacity, duty_starts_at, duty_ends_at,
           status, allocated_at)
          VALUES (${packageId}::uuid, ${workforcePool.id}::uuid, ${workforceCapacity},
            ${startsAt.toISOString()}::timestamptz, ${endsAt.toISOString()}::timestamptz,
            'reserved', ${now.toISOString()}::timestamptz)`.execute(transaction);
        if (fault)
          await sql`UPDATE maintenance_faults SET status = 'repair_planned'
            WHERE id = ${fault.id}::uuid AND status = 'open'`.execute(transaction);
        await appendHistory(transaction, aircraftId, "work_planned", now, {
          workPackageId: packageId,
          source,
          ruleCode: rule?.code,
          faultId: fault?.id,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          workforceCapacity,
          costMinor: costMinor.toString(),
        });
        await sql`INSERT INTO outbox_events
          (aggregate_type, aggregate_id, aggregate_version, event_type, payload, available_at)
          VALUES ('maintenance_work_package', ${packageId}::uuid, 1, 'maintenance.work_due.v1',
            ${JSON.stringify({ workPackageId: packageId, aircraftId })}::jsonb,
            ${endsAt.toISOString()}::timestamptz)`.execute(transaction);
        const created =
          await sql<PackageRow>`${packageSelect} WHERE package.id = ${packageId}::uuid`.execute(
            transaction,
          );
        return mapPackage(created.rows[0]!);
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    ).catch(mapConstraint);
  }

  public async completeWork(
    playerAccountId: string,
    airlineId: string,
    workPackageId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<MaintenanceWorkPackage> {
    return runInTransaction(
      this.database,
      async (transaction) => {
        const found = await sql<PackageRow>`${packageSelect}
          JOIN aircraft ac ON ac.id = package.aircraft_id
          JOIN resource_ownerships own ON own.resource_type = 'airline'
            AND own.resource_id = ac.operator_airline_id AND own.player_account_id = ${playerAccountId}::uuid
          WHERE package.id = ${workPackageId}::uuid AND ac.operator_airline_id = ${airlineId}::uuid
          FOR UPDATE OF package, ac`.execute(transaction);
        const row = found.rows[0];
        if (!row)
          throw new MaintenanceDomainError(
            "work_package_not_found",
            "Maintenance work package is unavailable.",
          );
        if (row.status === "completed") return mapPackage(row);
        if (now < row.ends_at)
          throw new MaintenanceDomainError(
            "invalid_window",
            "Maintenance work cannot complete before its reserved window ends.",
          );
        const context = await loadContext(transaction, playerAccountId, airlineId, row.aircraft_id);
        const ledger = new KyselyLedgerRepository(transaction, true);
        const amount = BigInt(row.cost_minor);
        const posted = await ledger.post({
          ledgerBookId: context.ledger_book_id,
          accountingPeriodId: context.accounting_period_id,
          idempotencyKey: `maintenance:${workPackageId}:${idempotencyKey}`,
          commandType: "maintenance",
          cashFlowActivity: "operating",
          description: `Complete ${row.source} maintenance work package ${workPackageId}`,
          occurredAt: now,
          transactionCurrency: context.reporting_currency,
          reportingCurrency: context.reporting_currency,
          postings: [
            {
              accountCode: "5200",
              side: "debit",
              transactionAmountMinor: amount,
              reportingAmountMinor: amount,
              dimensions: { airlineId, aircraftId: row.aircraft_id },
            },
            {
              accountCode: "1000",
              side: "credit",
              transactionAmountMinor: amount,
              reportingAmountMinor: amount,
              dimensions: { airlineId, aircraftId: row.aircraft_id },
            },
          ],
        });
        let restore = 250;
        if (row.rule_code) {
          const rule = await sql<{ id: string; condition_restore_basis_points: number }>`
            SELECT id, condition_restore_basis_points FROM maintenance_program_rules
            WHERE code = ${row.rule_code} AND maintenance_program_version_id = ${context.maintenance_program_version_id}::uuid
              AND aircraft_variant_id = ${context.aircraft_variant_id}::uuid`.execute(transaction);
          if (rule.rows[0]) {
            restore = rule.rows[0].condition_restore_basis_points;
            await sql`UPDATE aircraft_maintenance_due_counters SET
              baseline_hours_minutes = ${context.accumulated_hours_minutes}::bigint,
              baseline_cycles = ${context.accumulated_cycles}::bigint,
              calendar_started_at = ${now.toISOString()}::timestamptz, due_state = 'not_due',
              assessed_at = ${now.toISOString()}::timestamptz, version = version + 1
              WHERE aircraft_id = ${row.aircraft_id}::uuid
                AND maintenance_rule_id = ${rule.rows[0].id}::uuid`.execute(transaction);
          }
        }
        if (row.maintenance_fault_id)
          await sql`UPDATE maintenance_faults SET status = 'repaired', repaired_at = ${now.toISOString()}::timestamptz
            WHERE id = ${row.maintenance_fault_id}::uuid AND status = 'repair_planned'`.execute(
            transaction,
          );
        await sql`UPDATE aircraft SET condition_basis_points = LEAST(10000, condition_basis_points + ${restore}),
          dispatch_reliability_basis_points = LEAST(9990, dispatch_reliability_basis_points + ${Math.floor(restore / 2)}),
          version = version + 1 WHERE id = ${row.aircraft_id}::uuid`.execute(transaction);
        await sql`UPDATE maintenance_work_packages SET status = 'completed',
          journal_entry_id = ${posted.journalEntryId}::uuid, completed_at = ${now.toISOString()}::timestamptz
          WHERE id = ${workPackageId}::uuid`.execute(transaction);
        await sql`UPDATE maintenance_windows SET status = 'completed'
          WHERE maintenance_work_package_id = ${workPackageId}::uuid`.execute(transaction);
        await sql`UPDATE maintenance_workforce_allocations SET status = 'released',
          released_at = ${now.toISOString()}::timestamptz
          WHERE maintenance_work_package_id = ${workPackageId}::uuid AND status = 'reserved'`.execute(
          transaction,
        );
        await appendHistory(
          transaction,
          row.aircraft_id,
          "work_completed",
          now,
          {
            workPackageId,
            source: row.source,
            ruleCode: row.rule_code,
            faultId: row.maintenance_fault_id,
            costMinor: row.cost_minor,
            journalEntryId: posted.journalEntryId,
          },
          posted.journalEntryId,
        );
        if (row.maintenance_fault_id)
          await appendHistory(
            transaction,
            row.aircraft_id,
            "fault_repaired",
            now,
            {
              faultId: row.maintenance_fault_id,
              workPackageId,
              journalEntryId: posted.journalEntryId,
            },
            posted.journalEntryId,
          );
        await sql`INSERT INTO outbox_events
          (aggregate_type, aggregate_id, aggregate_version, event_type, payload, available_at)
          VALUES ('maintenance_work_package', ${workPackageId}::uuid, 2,
            'maintenance.work_completed.v1',
            ${JSON.stringify({ workPackageId, aircraftId: row.aircraft_id, journalEntryId: posted.journalEntryId })}::jsonb,
            ${now.toISOString()}::timestamptz)`.execute(transaction);
        const completed =
          await sql<PackageRow>`${packageSelect} WHERE package.id = ${workPackageId}::uuid`.execute(
            transaction,
          );
        return mapPackage(completed.rows[0]!);
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }

  public async forecast(
    playerAccountId: string,
    airlineId: string,
    aircraftId: string,
    now: Date,
  ): Promise<MaintenanceForecast> {
    return runInTransaction(this.database, async (transaction) => {
      const context = await loadContext(transaction, playerAccountId, airlineId, aircraftId);
      const rules = await loadRules(transaction, context);
      await sql`SELECT id FROM aircraft WHERE id = ${aircraftId}::uuid FOR UPDATE`.execute(
        transaction,
      );
      await ensureAssignment(transaction, context, rules, now);
      const due = await assess(transaction, context, rules, now, true);
      const packages = await sql<PackageRow>`${packageSelect}
        WHERE package.aircraft_id = ${aircraftId}::uuid ORDER BY maintenance_window.starts_at, package.id`.execute(
        transaction,
      );
      const faults = await sql<{
        id: string;
        outcome: "delay" | "grounding";
        grounds_aircraft: boolean;
        repair_duration_minutes: number;
        repair_workforce_capacity: number;
        outcome_snapshot: DeterministicFault;
      }>`SELECT id, outcome, grounds_aircraft, repair_duration_minutes,
        repair_workforce_capacity, outcome_snapshot FROM maintenance_faults
        WHERE aircraft_id = ${aircraftId}::uuid AND status <> 'repaired'
        ORDER BY discovered_at, id`.execute(transaction);
      const blockingDue = due.filter((item) => item.hardLimitExceeded);
      const upcomingFlights = await sql<{ id: string; flight_number: string; departure_at: Date }>`
        SELECT id, flight_number, departure_at FROM dated_flights
        WHERE aircraft_id = ${aircraftId}::uuid AND status IN ('scheduled', 'sold')
          AND departure_at >= ${now.toISOString()}::timestamptz
        ORDER BY departure_at, id LIMIT 10`.execute(transaction);
      const unplannedDue = due.filter(
        (item) =>
          item.state !== "not_due" &&
          !packages.rows.some(
            (work) => work.status === "planned" && work.rule_code === item.ruleCode,
          ),
      );
      const scheduleConflicts = unplannedDue.flatMap((item) =>
        upcomingFlights.rows
          .slice(0, 3)
          .map(
            (flight) =>
              `${item.ruleCode} has no reserved downtime before ${flight.flight_number} at ${flight.departure_at.toISOString()}.`,
          ),
      );
      const activeWindow = packages.rows.some(
        (work) => work.status === "planned" && work.starts_at <= now && work.ends_at > now,
      );
      const grounded = faults.rows.some((fault) => fault.grounds_aircraft);
      const dispatchReady = blockingDue.length === 0 && !grounded && !activeWindow;
      return {
        aircraftId,
        generatedAt: now.toISOString(),
        programVersion: context.maintenance_program_version,
        dispatchReady,
        conditionBasisPoints: context.condition_basis_points,
        dispatchReliabilityBasisPoints: context.dispatch_reliability_basis_points,
        due,
        plannedWork: packages.rows.map(mapPackage),
        activeFaults: faults.rows.map((fault) => ({
          id: fault.id,
          outcome: fault.outcome,
          groundsAircraft: fault.grounds_aircraft,
          repairDurationMinutes: fault.repair_duration_minutes,
          repairWorkforceCapacity: fault.repair_workforce_capacity,
          explanation: fault.outcome_snapshot.explanation,
        })),
        scheduleConflicts,
        workforceNeeds: unplannedDue.map((item) => {
          const rule = rules.find((candidate) => candidate.code === item.ruleCode)!;
          return `${item.ruleCode} needs ${rule.workforce_capacity} line-maintenance capacity for ${rule.duration_minutes} minutes at ${context.base_iata_code}.`;
        }),
        explanations: [
          "Flight hours and cycles come only from exact-once persisted completion inputs.",
          "Calendar limits advance one day per elapsed UTC day; no accelerated aging job is used.",
          "Soft deferrals are bounded and reduce condition and dispatch reliability; hard limits and grounding faults block dispatch.",
          "Planned windows share transactional aircraft occupancy and qualified workforce protections with active flights.",
        ],
        recoverySteps: [
          ...blockingDue.map((item) => item.recoveryStep),
          ...faults.rows
            .filter((fault) => fault.grounds_aircraft)
            .map(
              (fault) =>
                `Schedule and complete fault ${fault.id}: ${fault.repair_duration_minutes} minutes with ${fault.repair_workforce_capacity} qualified line-maintenance capacity.`,
            ),
          ...(activeWindow
            ? ["Complete the active maintenance work package before dispatch."]
            : []),
        ],
      };
    });
  }

  public async dispatchReadiness(
    playerAccountId: string,
    airlineId: string,
    aircraftId: string,
    at: Date,
  ): Promise<MaintenanceForecast> {
    return this.forecast(playerAccountId, airlineId, aircraftId, at);
  }

  public async history(
    playerAccountId: string,
    airlineId: string,
    aircraftId: string,
  ): Promise<readonly MaintenanceHistoryEvent[]> {
    await loadContext(this.database, playerAccountId, airlineId, aircraftId);
    const result = await sql<{
      id: string;
      aircraft_id: string;
      sequence: string;
      event_type: string;
      occurred_at: Date;
      details: Record<string, unknown>;
      journal_entry_id: string | null;
    }>`SELECT id, aircraft_id, sequence::text, event_type, occurred_at, details, journal_entry_id
      FROM maintenance_history WHERE aircraft_id = ${aircraftId}::uuid ORDER BY sequence`.execute(
      this.database,
    );
    return result.rows.map((row) => ({
      id: row.id,
      aircraftId: row.aircraft_id,
      sequence: row.sequence,
      eventType: row.event_type,
      occurredAt: row.occurred_at.toISOString(),
      details: row.details,
      ...(row.journal_entry_id ? { journalEntryId: row.journal_entry_id } : {}),
    }));
  }
}
