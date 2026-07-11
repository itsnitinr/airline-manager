import { createHash, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import {
  FleetDomainError,
  chronologicalAgeSeconds,
  createLeasePaymentSchedule,
  type CurrencyCode,
  type FleetAircraft,
  type FleetRepository,
  type FounderLeaseAcceptance,
  type FounderLeasePreview,
  type FounderPackageComparison,
  type FounderPackageOption,
} from "@airline-manager/domain";
import type { Database } from "../database.js";
import type { DB } from "../generated/database.js";
import { KyselyLedgerRepository } from "../finance/repository.js";
import { KyselyIdentityRepository } from "../identity/repository.js";
import { runInTransaction } from "../transactions.js";

type Queryable = Database | Transaction<DB>;

export const fleetMaterialStages = [
  "idempotency",
  "lease",
  "aircraft",
  "ownership",
  "ledger",
  "outbox",
] as const;
export type FleetMaterialStage = (typeof fleetMaterialStages)[number];
type FaultInjector = (stage: FleetMaterialStage) => void | Promise<void>;

type OptionRow = Readonly<{
  option_id: string;
  option_code: string;
  package_version: string;
  release_id: string;
  release_version: string;
  ruleset_id: string;
  ruleset_version: string;
  variant_id: string;
  variant_code: string;
  manufacturer: string;
  model: string;
  category: FounderPackageOption["variant"]["category"];
  range_nm: number;
  typical_seats: number;
  maximum_seats: number;
  minimum_runway_ft: number;
  production_status: FounderPackageOption["variant"]["productionStatus"];
  economy_seats: number;
  delivery_delay_minutes: number;
  term_days: number;
  payment_interval_days: number;
  payment_count: number;
  recurring_payment_minor: unknown;
  deposit_minor: unknown;
  deposit_subsidy_minor: unknown;
  network_summary: string;
  cost_summary: string;
  delivery_summary: string;
  commonality_risk_summary: string;
  runway_tradeoff_summary: string;
  usage_conditions: unknown;
  return_conditions: unknown;
  lessor_id: string;
  lessor_name: string;
  currency: CurrencyCode;
  career_id: string;
  base_airport_id: string;
  station_id: string;
  allowed_channels: string[];
  variant_snapshot: unknown;
}>;

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function exactValue(values: unknown, currency: CurrencyCode, label: string): bigint {
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    throw new Error(`${label} map is invalid.`);
  }
  const value = (values as Record<string, unknown>)[currency];
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new Error(`${label} is unavailable for the reporting currency.`);
  }
  return BigInt(value);
}

function optionFromRow(row: OptionRow): FounderPackageOption {
  const recurring = exactValue(
    row.recurring_payment_minor,
    row.currency,
    "Recurring lease payment",
  );
  const deposit = exactValue(row.deposit_minor, row.currency, "Lease deposit");
  const subsidy = exactValue(row.deposit_subsidy_minor, row.currency, "Lease deposit subsidy");
  if (subsidy > deposit) throw new Error("Lease subsidy exceeds the deposit.");
  return {
    code: row.option_code,
    packageVersion: row.package_version,
    catalogReleaseVersion: row.release_version,
    worldRulesetVersion: row.ruleset_version,
    variant: {
      id: row.variant_id,
      code: row.variant_code,
      manufacturer: row.manufacturer,
      model: row.model,
      category: row.category,
      rangeNm: row.range_nm,
      typicalSeats: row.typical_seats,
      maximumSeats: row.maximum_seats,
      minimumRunwayFt: row.minimum_runway_ft,
      productionStatus: row.production_status,
      acquisitionChannel: "operating_lease",
    },
    cabin: {
      configurationKind: "physical_cabin",
      economySeats: row.economy_seats,
      bookingClassesConfigured: false,
    },
    lease: {
      currency: row.currency,
      termDays: row.term_days,
      paymentIntervalDays: row.payment_interval_days,
      paymentCount: row.payment_count,
      recurringPaymentMinor: recurring.toString(),
      depositMinor: deposit.toString(),
      depositSubsidyMinor: subsidy.toString(),
      refundableDepositMinor: (deposit - subsidy).toString(),
    },
    delivery: {
      delayMinutes: row.delivery_delay_minutes,
      immediate: row.delivery_delay_minutes === 0,
      maximumDelayMinutes: 1440,
    },
    tradeoffs: {
      network: row.network_summary,
      cost: row.cost_summary,
      delivery: row.delivery_summary,
      commonalityRisk: row.commonality_risk_summary,
      runway: row.runway_tradeoff_summary,
    },
    viable: true,
    provenanceNotice:
      "Range, capacity, runway envelope, and production status come from the accepted catalog snapshot; lease economics and compressed delivery are versioned balance data.",
  };
}

async function optionRows(
  database: Queryable,
  playerAccountId: string,
  airlineId: string,
  optionCode?: string,
  lockCareer = false,
): Promise<readonly OptionRow[]> {
  const result = await sql<OptionRow>`SELECT o.id AS option_id, o.code AS option_code,
    p.version AS package_version, c.catalog_release_id AS release_id,
    cr.version AS release_version, c.world_ruleset_id AS ruleset_id,
    w.version AS ruleset_version, v.id AS variant_id, v.code AS variant_code,
    v.manufacturer, v.model, v.category, v.range_nm, v.typical_seats, v.maximum_seats,
    v.minimum_runway_ft, (m.snapshot ->> 'productionStatus') AS production_status,
    o.economy_seats, o.delivery_delay_minutes,
    o.term_days, o.payment_interval_days, o.payment_count, o.recurring_payment_minor,
    o.deposit_minor, o.deposit_subsidy_minor, o.network_summary, o.cost_summary,
    o.delivery_summary, o.commonality_risk_summary, o.runway_tradeoff_summary,
    o.usage_conditions, o.return_conditions, l.id AS lessor_id, l.name AS lessor_name,
    a.reporting_currency AS currency, c.id AS career_id, a.principal_base_airport_id AS base_airport_id,
    s.id AS station_id, m.snapshot AS variant_snapshot,
    COALESCE(x.channels, CASE WHEN (m.snapshot ->> 'productionStatus') = 'discontinued'
      THEN ARRAY['operating_lease', 'used_purchase']::text[]
      ELSE ARRAY['factory_new', 'operating_lease', 'used_purchase']::text[] END) AS allowed_channels
    FROM airlines a
    JOIN careers c ON c.id = a.career_id
    JOIN resource_ownerships own ON own.resource_type = 'airline' AND own.resource_id = a.id
      AND own.player_account_id = ${playerAccountId}::uuid
    JOIN world_rulesets w ON w.id = c.world_ruleset_id AND w.status = 'active'
    JOIN catalog_releases cr ON cr.id = c.catalog_release_id AND cr.status = 'published'
    JOIN founder_package_versions p ON p.world_ruleset_id = c.world_ruleset_id AND p.status = 'active'
    JOIN founder_package_options o ON o.package_version_id = p.id
    JOIN curated_aircraft_variants v ON v.id = o.aircraft_variant_id
    JOIN catalog_release_aircraft_variants m ON m.release_id = c.catalog_release_id
      AND m.aircraft_variant_id = v.id
    JOIN aircraft_lessors l ON l.id = o.lessor_id
    JOIN airline_stations s ON s.airline_id = a.id AND s.station_role = 'principal_base'
    LEFT JOIN world_ruleset_acquisition_overrides x ON x.world_ruleset_id = c.world_ruleset_id
      AND x.aircraft_variant_id = v.id
    WHERE a.id = ${airlineId}::uuid ${optionCode ? sql`AND o.code = ${optionCode}` : sql``}
    ORDER BY o.code ${lockCareer ? sql`FOR UPDATE OF c` : sql``}`.execute(database);
  return result.rows;
}

type AircraftRow = Readonly<{
  id: string;
  serial_number: string;
  catalog_release_id: string;
  catalog_release_version: string;
  aircraft_variant_id: string;
  variant_snapshot: unknown;
  operator_airline_id: string | null;
  owner_lessor_id: string;
  lessor_name: string;
  operating_lease_id: string;
  current_airport_id: string | null;
  planned_airport_id: string | null;
  delivery_state: FleetAircraft["deliveryState"];
  delivery_target_at: Date;
  delivered_at: Date | null;
  manufactured_at: Date;
  initial_chronological_age_seconds: string;
  accumulated_hours_minutes: string;
  accumulated_cycles: string;
  condition_basis_points: number;
  dispatch_reliability_basis_points: number;
  version: string;
  economy_seats: number;
  premium_economy_seats: number;
  business_seats: number;
  first_seats: number;
  airline_id: string | null;
}>;

function aircraftFromRow(row: AircraftRow, now: Date): FleetAircraft {
  const snapshot = row.variant_snapshot as Record<string, unknown>;
  return {
    id: row.id,
    serialNumber: row.serial_number,
    airlineId: row.airline_id,
    leaseId: row.operating_lease_id,
    catalogReleaseId: row.catalog_release_id,
    catalogReleaseVersion: row.catalog_release_version,
    variantId: row.aircraft_variant_id,
    variantCode: String(snapshot.code),
    manufacturer: String(snapshot.manufacturer),
    model: String(snapshot.model),
    owner: { lessorId: row.owner_lessor_id, name: row.lessor_name },
    operatorAirlineId: row.operator_airline_id,
    currentAirportId: row.current_airport_id,
    plannedAirportId: row.planned_airport_id,
    deliveryState: row.delivery_state,
    deliveryTargetAt: row.delivery_target_at.toISOString(),
    deliveredAt: row.delivered_at?.toISOString() ?? null,
    manufacturedAt: row.manufactured_at.toISOString(),
    chronologicalAgeSeconds: chronologicalAgeSeconds(
      row.manufactured_at,
      BigInt(row.initial_chronological_age_seconds),
      now,
    ).toString(),
    accumulatedHoursMinutes: row.accumulated_hours_minutes,
    accumulatedCycles: row.accumulated_cycles,
    conditionBasisPoints: row.condition_basis_points,
    dispatchReliabilityBasisPoints: row.dispatch_reliability_basis_points,
    version: row.version,
    cabin: {
      configurationKind: "physical_cabin",
      economySeats: row.economy_seats,
      premiumEconomySeats: 0,
      businessSeats: 0,
      firstSeats: 0,
      bookingClassesConfigured: false,
    },
    restrictions: { sale: true, collateral: true, cashExtraction: true },
  };
}

async function aircraftRows(
  database: Queryable,
  playerAccountId: string | undefined,
  filter: { aircraftId?: string; airlineId?: string; leaseId?: string },
  lock = false,
): Promise<readonly AircraftRow[]> {
  const result = await sql<AircraftRow>`SELECT ac.id, ac.serial_number, ac.catalog_release_id,
    cr.version AS catalog_release_version, ac.aircraft_variant_id, ac.variant_snapshot,
    ac.operator_airline_id, ac.owner_lessor_id, l.name AS lessor_name, ac.operating_lease_id,
    ac.current_airport_id, ac.planned_airport_id, ac.delivery_state, ac.delivery_target_at,
    ac.delivered_at, ac.manufactured_at, ac.initial_chronological_age_seconds::text,
    ac.accumulated_hours_minutes::text, ac.accumulated_cycles::text,
    ac.condition_basis_points, ac.dispatch_reliability_basis_points, ac.version::text,
    cab.economy_seats, cab.premium_economy_seats, cab.business_seats, cab.first_seats,
    ol.airline_id
    FROM aircraft ac
    JOIN catalog_releases cr ON cr.id = ac.catalog_release_id
    JOIN aircraft_lessors l ON l.id = ac.owner_lessor_id
    JOIN operating_leases ol ON ol.id = ac.operating_lease_id
    JOIN aircraft_cabin_configurations cab ON cab.aircraft_id = ac.id
    ${
      playerAccountId
        ? sql`JOIN resource_ownerships own ON own.resource_type = 'aircraft'
      AND own.resource_id = ac.id AND own.player_account_id = ${playerAccountId}::uuid`
        : sql``
    }
    WHERE true
      ${filter.aircraftId ? sql`AND ac.id = ${filter.aircraftId}::uuid` : sql``}
      ${filter.airlineId ? sql`AND ol.airline_id = ${filter.airlineId}::uuid` : sql``}
      ${filter.leaseId ? sql`AND ol.id = ${filter.leaseId}::uuid` : sql``}
    ORDER BY ac.created_at, ac.id ${lock ? sql`FOR UPDATE OF ac, ol` : sql``}`.execute(database);
  return result.rows;
}

export class KyselyFleetRepository implements FleetRepository {
  public constructor(
    private readonly database: Database,
    private readonly faultInjector?: FaultInjector,
  ) {}

  private async stage(stage: FleetMaterialStage): Promise<void> {
    await this.faultInjector?.(stage);
  }

  public async listFounderPackage(
    playerAccountId: string,
    airlineId: string,
  ): Promise<FounderPackageComparison> {
    const rows = await optionRows(this.database, playerAccountId, airlineId);
    const first = rows[0];
    if (!first)
      throw new FleetDomainError("founder_package_not_found", "Founder package is unavailable.");
    return {
      airlineId,
      careerId: first.career_id,
      packageVersion: first.package_version,
      options: rows.map(optionFromRow),
      exactlyOneMayBeAccepted: true,
    };
  }

  public async previewFounderLease(
    playerAccountId: string,
    airlineId: string,
    optionCode: string,
    now: Date,
  ): Promise<FounderLeasePreview> {
    const rows = await optionRows(this.database, playerAccountId, airlineId, optionCode);
    const row = rows[0];
    if (!row)
      throw new FleetDomainError(
        "founder_option_not_found",
        "Founder lease option is unavailable.",
      );
    const existing = await sql<{ exists: boolean }>`SELECT EXISTS (SELECT 1 FROM operating_leases
      WHERE career_id = ${row.career_id}::uuid) AS exists`.execute(this.database);
    if (existing.rows[0]?.exists) {
      throw new FleetDomainError(
        "founder_lease_already_accepted",
        "This career already accepted its founder lease.",
      );
    }
    this.validateOption(row);
    const option = optionFromRow(row);
    return {
      option,
      deliveryTargetAt: new Date(
        now.getTime() + option.delivery.delayMinutes * 60_000,
      ).toISOString(),
      principalBaseAirportId: row.base_airport_id,
      paymentSchedule: createLeasePaymentSchedule(
        BigInt(option.lease.recurringPaymentMinor),
        option.lease.paymentIntervalDays,
        option.lease.paymentCount,
        now,
      ),
      nextStep: "accept_founder_lease",
      nextStepGuidance:
        "Accept this one operating lease to create the aircraft and its exact payment schedule atomically.",
    };
  }

  private validateOption(row: OptionRow): void {
    if (!row.allowed_channels.includes("operating_lease")) {
      throw new FleetDomainError(
        "founder_option_ineligible",
        "The selected contemporary world ruleset does not allow this acquisition channel.",
      );
    }
    if (row.economy_seats > row.maximum_seats || row.economy_seats < 1) {
      throw new FleetDomainError(
        "invalid_cabin_configuration",
        "Economy cabin exceeds the accepted variant limits.",
      );
    }
    if (row.delivery_delay_minutes > 1440) {
      throw new FleetDomainError(
        "founder_option_ineligible",
        "Founder delivery delay exceeds 24 real hours.",
      );
    }
  }

  public async acceptFounderLease(
    playerAccountId: string,
    airlineId: string,
    optionCode: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<FounderLeaseAcceptance> {
    const hash = requestHash({ airlineId, optionCode });
    try {
      return await runInTransaction(
        this.database,
        async (transaction) => {
          const scope = `founder-lease:${airlineId}`;
          await sql`INSERT INTO idempotency_commands
          (scope, idempotency_key, command_type, request_hash, expires_at)
          VALUES (${scope}, ${idempotencyKey}, 'founder_lease_acceptance', ${hash},
            CURRENT_TIMESTAMP + INTERVAL '30 days') ON CONFLICT (scope, idempotency_key) DO NOTHING`.execute(
            transaction,
          );
          const idempotency = await sql<{
            request_hash: string;
            state: string;
            response_body: unknown;
          }>`
          SELECT request_hash, state, response_body FROM idempotency_commands
          WHERE scope = ${scope} AND idempotency_key = ${idempotencyKey} FOR UPDATE`.execute(
            transaction,
          );
          const command = idempotency.rows[0];
          if (!command) throw new Error("Founder lease idempotency record is unavailable.");
          if (command.request_hash.trim() !== hash) {
            throw new FleetDomainError(
              "idempotency_conflict",
              "Idempotency key was reused with a different founder option.",
            );
          }
          if (command.state === "completed") return command.response_body as FounderLeaseAcceptance;
          await this.stage("idempotency");

          const rows = await optionRows(transaction, playerAccountId, airlineId, optionCode, true);
          const row = rows[0];
          if (!row)
            throw new FleetDomainError(
              "founder_option_not_found",
              "Founder lease option is unavailable.",
            );
          this.validateOption(row);
          const existing = await sql<{
            exists: boolean;
          }>`SELECT EXISTS (SELECT 1 FROM operating_leases
          WHERE career_id = ${row.career_id}::uuid) AS exists`.execute(transaction);
          if (existing.rows[0]?.exists) {
            throw new FleetDomainError(
              "founder_lease_already_accepted",
              "This career already accepted its founder lease.",
            );
          }
          const option = optionFromRow(row);
          const target = new Date(now.getTime() + option.delivery.delayMinutes * 60_000);
          const matures = new Date(now.getTime() + option.lease.termDays * 86_400_000);
          const leaseResult = await sql<{ id: string }>`INSERT INTO operating_leases
          (career_id, airline_id, founder_package_option_id, lessor_id, currency, starts_at, matures_at)
          VALUES (${row.career_id}::uuid, ${airlineId}::uuid, ${row.option_id}::uuid,
            ${row.lessor_id}::uuid, ${row.currency}, ${now.toISOString()}::timestamptz,
            ${matures.toISOString()}::timestamptz) RETURNING id`.execute(transaction);
          const leaseId = leaseResult.rows[0]?.id;
          if (!leaseId) throw new Error("Founder lease was not created.");
          const deposit = BigInt(option.lease.depositMinor);
          const subsidy = BigInt(option.lease.depositSubsidyMinor);
          await sql`INSERT INTO operating_lease_terms
          (lease_id, version, effective_at, term_days, payment_interval_days, payment_count,
           recurring_payment_minor, deposit_minor, deposit_subsidy_minor, refundable_deposit_minor,
           usage_conditions, return_conditions, delivery_terms)
          VALUES (${leaseId}::uuid, 1, ${now.toISOString()}::timestamptz, ${option.lease.termDays},
            ${option.lease.paymentIntervalDays}, ${option.lease.paymentCount},
            ${option.lease.recurringPaymentMinor}::bigint, ${deposit.toString()}::bigint,
            ${subsidy.toString()}::bigint, ${(deposit - subsidy).toString()}::bigint,
            ${JSON.stringify(row.usage_conditions)}::jsonb, ${JSON.stringify(row.return_conditions)}::jsonb,
            ${JSON.stringify({
              targetAt: target.toISOString(),
              delayMinutes: option.delivery.delayMinutes,
              maximumDelayMinutes: 1440,
              destinationAirportId: row.base_airport_id,
            })}::jsonb)`.execute(transaction);
          const payments = createLeasePaymentSchedule(
            BigInt(option.lease.recurringPaymentMinor),
            option.lease.paymentIntervalDays,
            option.lease.paymentCount,
            now,
          );
          for (const payment of payments) {
            await sql`INSERT INTO operating_lease_payment_schedule
            (lease_id, term_version, payment_number, due_at, amount_minor)
            VALUES (${leaseId}::uuid, 1, ${payment.paymentNumber}, ${payment.dueAt}::timestamptz,
              ${payment.amountMinor}::bigint)`.execute(transaction);
          }
          await this.stage("lease");

          const aircraftId = randomUUID();
          const immediate = option.delivery.immediate;
          const serial = `FND-${row.variant_code.toUpperCase()}-${aircraftId.slice(0, 8).toUpperCase()}`;
          await sql`INSERT INTO aircraft
          (id, serial_number, catalog_release_id, aircraft_variant_id, variant_snapshot,
           operator_airline_id, owner_lessor_id, operating_lease_id, current_airport_id,
           planned_airport_id, delivery_state, delivery_target_at, delivered_at, manufactured_at,
           condition_basis_points, dispatch_reliability_basis_points, created_at)
          VALUES (${aircraftId}::uuid, ${serial}, ${row.release_id}::uuid, ${row.variant_id}::uuid,
            ${JSON.stringify(row.variant_snapshot)}::jsonb, ${airlineId}::uuid, ${row.lessor_id}::uuid,
            ${leaseId}::uuid, ${immediate ? row.base_airport_id : null}::uuid,
            ${row.base_airport_id}::uuid, ${immediate ? "delivered" : "pending"},
            ${target.toISOString()}::timestamptz, ${immediate ? now.toISOString() : null}::timestamptz,
            ${now.toISOString()}::timestamptz, 10000, 9900, ${now.toISOString()}::timestamptz)`.execute(
            transaction,
          );
          await sql`UPDATE operating_leases SET aircraft_id = ${aircraftId}::uuid WHERE id = ${leaseId}::uuid`.execute(
            transaction,
          );
          await sql`INSERT INTO aircraft_cabin_configurations
          (aircraft_id, economy_seats, configured_at)
          VALUES (${aircraftId}::uuid, ${option.cabin.economySeats}, ${now.toISOString()}::timestamptz)`.execute(
            transaction,
          );
          await sql`INSERT INTO aircraft_lifecycle_events
          (aircraft_id, aircraft_version, event_type, occurred_at, airport_id, details)
          VALUES (${aircraftId}::uuid, 1, 'accepted', ${now.toISOString()}::timestamptz,
            ${immediate ? row.base_airport_id : null}::uuid,
            ${JSON.stringify({
              leaseId,
              packageVersion: option.packageVersion,
              optionCode,
              catalogReleaseVersion: row.release_version,
              worldRulesetVersion: row.ruleset_version,
            })}::jsonb)`.execute(transaction);
          await sql`INSERT INTO aircraft_lifecycle_events
          (aircraft_id, aircraft_version, event_type, occurred_at, airport_id, details)
          VALUES (${aircraftId}::uuid, 1, ${immediate ? "delivered" : "delivery_scheduled"},
            ${now.toISOString()}::timestamptz, ${row.base_airport_id}::uuid,
            ${JSON.stringify({ deliveryTargetAt: target.toISOString() })}::jsonb)`.execute(
            transaction,
          );
          await this.stage("aircraft");
          await new KyselyIdentityRepository(transaction).bindResourceOwnership({
            resourceType: "aircraft",
            resourceId: aircraftId,
            playerAccountId,
          });
          await this.stage("ownership");

          const book = await sql<{ id: string; period_id: string }>`SELECT b.id,
          (SELECT p.id FROM accounting_periods p WHERE p.ledger_book_id = b.id AND p.status = 'open'
            AND ${now.toISOString()}::timestamptz::date BETWEEN p.starts_on AND p.ends_on LIMIT 1) AS period_id
          FROM ledger_books b WHERE b.owner_type = 'airline' AND b.owner_id = ${airlineId}::uuid`.execute(
            transaction,
          );
          const ledgerBookId = book.rows[0]?.id;
          const periodId = book.rows[0]?.period_id;
          if (!ledgerBookId || !periodId)
            throw new Error("Airline ledger or accounting period is unavailable.");
          const ledger = new KyselyLedgerRepository(transaction, true);
          if (deposit > 0n) {
            await ledger.post({
              ledgerBookId,
              accountingPeriodId: periodId,
              idempotencyKey: `${idempotencyKey}:deposit`,
              commandType: "lease",
              cashFlowActivity: "financing",
              description: "Founder lease deposit",
              occurredAt: now,
              transactionCurrency: row.currency,
              reportingCurrency: row.currency,
              postings: [
                {
                  accountCode: "1600",
                  side: "debit",
                  transactionAmountMinor: deposit,
                  reportingAmountMinor: deposit,
                  dimensions: {
                    airlineId,
                    aircraftId,
                    stationId: row.station_id,
                    contractId: leaseId,
                  },
                },
                {
                  accountCode: "1000",
                  side: "credit",
                  transactionAmountMinor: deposit,
                  reportingAmountMinor: deposit,
                  dimensions: {
                    airlineId,
                    aircraftId,
                    stationId: row.station_id,
                    contractId: leaseId,
                  },
                },
              ],
            });
          }
          if (subsidy > 0n) {
            await ledger.post({
              ledgerBookId,
              accountingPeriodId: periodId,
              idempotencyKey: `${idempotencyKey}:deposit-subsidy`,
              commandType: "lease",
              cashFlowActivity: "financing",
              description: "Founder lease deposit subsidy",
              occurredAt: now,
              transactionCurrency: row.currency,
              reportingCurrency: row.currency,
              postings: [
                {
                  accountCode: "1000",
                  side: "debit",
                  transactionAmountMinor: subsidy,
                  reportingAmountMinor: subsidy,
                  dimensions: {
                    airlineId,
                    aircraftId,
                    stationId: row.station_id,
                    contractId: leaseId,
                  },
                },
                {
                  accountCode: "1600",
                  side: "credit",
                  transactionAmountMinor: subsidy,
                  reportingAmountMinor: subsidy,
                  dimensions: {
                    airlineId,
                    aircraftId,
                    stationId: row.station_id,
                    contractId: leaseId,
                  },
                },
              ],
            });
          }
          await this.stage("ledger");
          await sql`INSERT INTO outbox_events
          (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at, available_at)
          VALUES ('aircraft', ${aircraftId}::uuid, 1, 'aircraft.founder_lease_accepted.v1',
            ${JSON.stringify({
              aircraftId,
              leaseId,
              airlineId,
              deliveryTargetAt: target.toISOString(),
              expectedVersion: "1",
              packageVersion: option.packageVersion,
            })}::jsonb,
            ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`.execute(
            transaction,
          );
          if (!immediate) {
            await sql`INSERT INTO outbox_events
            (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at, available_at)
            VALUES ('aircraft', ${aircraftId}::uuid, 1, 'aircraft.delivery_due.v1',
              ${JSON.stringify({ aircraftId, expectedVersion: "1", deliveryTargetAt: target.toISOString() })}::jsonb,
              ${now.toISOString()}::timestamptz, ${target.toISOString()}::timestamptz)`.execute(
              transaction,
            );
          }
          await this.stage("outbox");
          const createdRows = await aircraftRows(transaction, playerAccountId, { aircraftId });
          const aircraft = createdRows[0];
          if (!aircraft) throw new Error("Founder aircraft was not created.");
          const result: FounderLeaseAcceptance = {
            airlineId,
            careerId: row.career_id,
            packageVersion: option.packageVersion,
            lease: {
              id: leaseId,
              status: "active",
              version: "1",
              startsAt: now.toISOString(),
              maturesAt: matures.toISOString(),
              currency: row.currency,
              paymentSchedule: payments,
            },
            aircraft: aircraftFromRow(aircraft, now),
            nextStep: immediate ? "plan_first_route" : "await_aircraft_delivery",
            nextStepGuidance: immediate
              ? "The aircraft is delivered at the principal base and ready for route planning."
              : "The aircraft is committed but unavailable until its authoritative delivery target.",
          };
          await sql`UPDATE idempotency_commands SET state = 'completed', response_status = 201,
          response_body = ${JSON.stringify(result)}::jsonb, updated_at = CURRENT_TIMESTAMP
          WHERE scope = ${scope} AND idempotency_key = ${idempotencyKey}`.execute(transaction);
          return result;
        },
        { isolationLevel: "serializable", maximumAttempts: 5 },
      );
    } catch (error) {
      if (error instanceof FleetDomainError) throw error;
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        const constraint =
          "constraint" in error && typeof error.constraint === "string" ? error.constraint : "";
        if (
          constraint.includes("operating_leases_career_id") ||
          constraint.includes("operating_leases_airline_id")
        ) {
          throw new FleetDomainError(
            "founder_lease_already_accepted",
            "This career already accepted its founder lease.",
          );
        }
      }
      throw error;
    }
  }

  public async listFleet(
    playerAccountId: string,
    airlineId: string,
    now: Date,
  ): Promise<readonly FleetAircraft[]> {
    return (await aircraftRows(this.database, playerAccountId, { airlineId })).map((row) =>
      aircraftFromRow(row, now),
    );
  }

  public async getAircraft(
    playerAccountId: string,
    aircraftId: string,
    now: Date,
  ): Promise<FleetAircraft> {
    const row = (await aircraftRows(this.database, playerAccountId, { aircraftId }))[0];
    if (!row) throw new FleetDomainError("aircraft_not_found", "Aircraft is unavailable.");
    return aircraftFromRow(row, now);
  }

  public async completeDueDelivery(
    aircraftId: string,
    expectedVersion: bigint,
    now: Date,
  ): Promise<FleetAircraft> {
    return runInTransaction(
      this.database,
      async (transaction) => {
        const row = (await aircraftRows(transaction, undefined, { aircraftId }, true))[0];
        if (!row) throw new FleetDomainError("aircraft_not_found", "Aircraft is unavailable.");
        if (row.delivery_state === "delivered") return aircraftFromRow(row, now);
        if (row.delivery_state !== "pending") {
          throw new FleetDomainError(
            "invalid_lease_transition",
            "Only pending aircraft can be delivered.",
          );
        }
        if (BigInt(row.version) !== expectedVersion) {
          throw new FleetDomainError(
            "stale_aircraft_version",
            "Aircraft optimistic version is stale.",
          );
        }
        if (now < row.delivery_target_at) {
          throw new FleetDomainError(
            "aircraft_not_due",
            "Aircraft cannot become available before its delivery target.",
          );
        }
        const nextVersion = expectedVersion + 1n;
        await sql`UPDATE aircraft SET delivery_state = 'delivered', current_airport_id = planned_airport_id,
        delivered_at = ${now.toISOString()}::timestamptz, version = ${nextVersion.toString()}::bigint
        WHERE id = ${aircraftId}::uuid AND version = ${expectedVersion.toString()}::bigint`.execute(
          transaction,
        );
        await sql`INSERT INTO aircraft_lifecycle_events
        (aircraft_id, aircraft_version, event_type, occurred_at, airport_id, details)
        VALUES (${aircraftId}::uuid, ${nextVersion.toString()}::bigint, 'delivered',
          ${now.toISOString()}::timestamptz, ${row.planned_airport_id}::uuid,
          ${JSON.stringify({ deliveryTargetAt: row.delivery_target_at.toISOString() })}::jsonb)`.execute(
          transaction,
        );
        await sql`INSERT INTO outbox_events
        (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at, available_at)
        VALUES ('aircraft', ${aircraftId}::uuid, ${nextVersion.toString()}::bigint, 'aircraft.delivered.v1',
          ${JSON.stringify({
            aircraftId,
            priorVersion: expectedVersion.toString(),
            deliveredAt: now.toISOString(),
            airportId: row.planned_airport_id,
          })}::jsonb,
          ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`.execute(
          transaction,
        );
        const delivered = (await aircraftRows(transaction, undefined, { aircraftId }))[0];
        if (!delivered) throw new Error("Delivered aircraft disappeared.");
        return aircraftFromRow(delivered, now);
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }

  public async transitionLease(
    leaseId: string,
    expectedAircraftVersion: bigint,
    target: "returned" | "defaulted",
    now: Date,
  ): Promise<FleetAircraft> {
    return runInTransaction(
      this.database,
      async (transaction) => {
        const row = (await aircraftRows(transaction, undefined, { leaseId }, true))[0];
        if (!row)
          throw new FleetDomainError("aircraft_not_found", "Lease aircraft is unavailable.");
        const lease = await sql<{
          status: string;
          return_conditions: unknown;
        }>`SELECT l.status, t.return_conditions
        FROM operating_leases l JOIN operating_lease_terms t ON t.lease_id = l.id AND t.version = 1
        WHERE l.id = ${leaseId}::uuid`.execute(transaction);
        if (lease.rows[0]?.status === target && row.delivery_state === target)
          return aircraftFromRow(row, now);
        if (lease.rows[0]?.status !== "active") {
          throw new FleetDomainError(
            "invalid_lease_transition",
            "Lease has already reached a terminal state.",
          );
        }
        if (BigInt(row.version) !== expectedAircraftVersion) {
          throw new FleetDomainError(
            "stale_aircraft_version",
            "Aircraft optimistic version is stale.",
          );
        }
        if (target === "returned") {
          const conditions = lease.rows[0]?.return_conditions as Record<string, unknown>;
          if (
            row.delivery_state !== "delivered" ||
            (conditions.must_be_at_principal_base === true &&
              row.current_airport_id !== row.planned_airport_id) ||
            (typeof conditions.minimum_condition_basis_points === "number" &&
              row.condition_basis_points < conditions.minimum_condition_basis_points)
          ) {
            throw new FleetDomainError(
              "return_conditions_not_met",
              "Aircraft does not satisfy the append-only lease return conditions.",
            );
          }
        }
        const nextVersion = expectedAircraftVersion + 1n;
        await sql`UPDATE operating_leases SET status = ${target}, ended_at = ${now.toISOString()}::timestamptz,
        version = version + 1 WHERE id = ${leaseId}::uuid AND status = 'active'`.execute(
          transaction,
        );
        await sql`UPDATE aircraft SET delivery_state = ${target}, operator_airline_id = NULL,
        version = ${nextVersion.toString()}::bigint WHERE id = ${row.id}::uuid
        AND version = ${expectedAircraftVersion.toString()}::bigint`.execute(transaction);
        await sql`UPDATE operating_lease_payment_schedule SET status = 'cancelled'
        WHERE lease_id = ${leaseId}::uuid AND status IN ('scheduled', 'overdue')`.execute(
          transaction,
        );
        await sql`INSERT INTO aircraft_lifecycle_events
        (aircraft_id, aircraft_version, event_type, occurred_at, airport_id, details)
        VALUES (${row.id}::uuid, ${nextVersion.toString()}::bigint, ${target},
          ${now.toISOString()}::timestamptz, ${row.current_airport_id}::uuid,
          ${JSON.stringify({ leaseId, cashMovementMinor: "0" })}::jsonb)`.execute(transaction);
        await sql`INSERT INTO outbox_events
        (aggregate_type, aggregate_id, aggregate_version, event_type, payload, occurred_at, available_at)
        VALUES ('aircraft', ${row.id}::uuid, ${nextVersion.toString()}::bigint,
          ${`aircraft.${target}.v1`}, ${JSON.stringify({
            aircraftId: row.id,
            leaseId,
            cashMovementMinor: "0",
          })}::jsonb, ${now.toISOString()}::timestamptz,
          ${now.toISOString()}::timestamptz)`.execute(transaction);
        const transitioned = (
          await aircraftRows(transaction, undefined, { aircraftId: row.id })
        )[0];
        if (!transitioned) throw new Error("Transitioned aircraft disappeared.");
        return aircraftFromRow(transitioned, now);
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }
}
