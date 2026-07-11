import { createHash, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import {
  FoundingDomainError,
  createFoundingLoanSchedule,
  forecastFoundingCashRunway,
  validateFoundingSelection,
  type AirlineBrand,
  type AirlineFoundingRepository,
  type AirlineSummary,
  type CurrencyCode,
  type FoundingBalance,
  type FoundingConfirmation,
  type FoundingPreview,
  type FoundingSelection,
} from "@airline-manager/domain";
import type { Database } from "../database.js";
import type { DB } from "../generated/database.js";
import { KyselyLedgerRepository } from "../finance/repository.js";
import { KyselyIdentityRepository } from "../identity/repository.js";
import { runInTransaction } from "../transactions.js";

export const foundingMaterialStages = [
  "idempotency",
  "career",
  "airline",
  "station",
  "financing",
  "ownership",
  "ledger_book",
  "equity",
  "loan",
  "outbox",
] as const;
export type FoundingMaterialStage = (typeof foundingMaterialStages)[number];

type FaultInjector = (stage: FoundingMaterialStage) => void | Promise<void>;

type Context = Readonly<{
  rulesetId: string;
  rulesetVersion: string;
  releaseId: string;
  releaseVersion: string;
  balance: FoundingBalance;
  airport: Readonly<{
    id: string;
    iataCode: string;
    name: string;
    countryCode: string;
  }>;
  normalizedName: string;
}>;

function requestHash(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (typeof item === "object" && item !== null) {
      return Object.fromEntries(
        Object.entries(item)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, canonical(nested)]),
      );
    }
    return item;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function exactValue(values: unknown, currency: CurrencyCode, label: string): bigint {
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    throw new Error(`${label} balance map is invalid.`);
  }
  const value = (values as Record<string, unknown>)[currency];
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} is unavailable for the reporting currency.`);
  }
  return BigInt(value);
}

function assumptions(value: unknown): FoundingBalance["assumptions"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Founding forecast assumptions are invalid.");
  }
  const input = value as Record<string, unknown>;
  if (
    !Array.isArray(input.included) ||
    !input.included.every((item) => typeof item === "string") ||
    !Array.isArray(input.excludedUntilTicket09) ||
    !input.excludedUntilTicket09.every((item) => typeof item === "string") ||
    typeof input.method !== "string"
  ) {
    throw new Error("Founding forecast assumptions are incomplete.");
  }
  return {
    included: input.included as string[],
    excludedUntilTicket09: input.excludedUntilTicket09 as string[],
    method: input.method,
  };
}

function serializeSchedule(
  schedule: ReturnType<typeof createFoundingLoanSchedule>,
): FoundingPreview["financing"]["optionalLoan"]["schedule"] {
  return schedule.map((installment) => ({
    installmentNumber: installment.installmentNumber,
    dueAt: installment.dueAt.toISOString(),
    principalMinor: installment.principalMinor.toString(),
    interestMinor: installment.interestMinor.toString(),
    totalMinor: installment.totalMinor.toString(),
  }));
}

function buildPreview(selection: FoundingSelection, context: Context, now: Date): FoundingPreview {
  const schedule = createFoundingLoanSchedule(
    context.balance.loanPrincipalMinor,
    context.balance.loanAnnualRateBasisPoints,
    context.balance.loanTermDays,
    context.balance.loanInstallmentCount,
    now,
  );
  return {
    normalizedAirlineName: context.normalizedName,
    catalogReleaseVersion: context.releaseVersion,
    worldRulesetVersion: context.rulesetVersion,
    foundingBalanceVersion: context.balance.version,
    principalBase: {
      airportId: context.airport.id,
      iataCode: context.airport.iataCode,
      name: context.airport.name,
      countryCode: context.airport.countryCode,
      stationServiceModel: "outsourced",
    },
    financing: {
      founderEquityMinor: context.balance.founderEquityMinor.toString(),
      optionalLoan: {
        principalMinor: context.balance.loanPrincipalMinor.toString(),
        annualRateBasisPoints: context.balance.loanAnnualRateBasisPoints,
        termDays: context.balance.loanTermDays,
        installmentCount: context.balance.loanInstallmentCount,
        selected: selection.acceptFoundingLoan,
        schedule: serializeSchedule(schedule),
      },
    },
    runway: forecastFoundingCashRunway(
      selection.reportingCurrency,
      context.balance,
      selection.acceptFoundingLoan,
      now,
    ),
    nextStep: "select_founder_aircraft",
    nextStepGuidance:
      "Choose one founder-aircraft lease package next. No aircraft or lease has been created or accepted yet.",
  };
}

export class KyselyAirlineFoundingRepository implements AirlineFoundingRepository {
  public constructor(
    private readonly database: Database,
    private readonly faultInjector?: FaultInjector,
  ) {}

  private async stage(stage: FoundingMaterialStage): Promise<void> {
    await this.faultInjector?.(stage);
  }

  private async context(
    database: Database | Transaction<DB>,
    playerAccountId: string,
    selection: FoundingSelection,
    lockPlayer: boolean,
  ): Promise<Context> {
    const normalizedName = validateFoundingSelection(selection);
    const player = await sql<{ id: string }>`SELECT id FROM player_accounts
      WHERE id = ${playerAccountId}::uuid ${lockPlayer ? sql`FOR UPDATE` : sql``}`.execute(
      database,
    );
    if (!player.rows[0]) {
      throw new FoundingDomainError(
        "inactive_world_ruleset",
        "The authenticated domain player account is unavailable.",
      );
    }
    const rules = await sql<{
      ruleset_id: string;
      ruleset_version: string;
      release_id: string;
      release_version: string;
      balance_id: string;
      balance_version: string;
      founder_equity_minor: unknown;
      founding_loan_principal_minor: unknown;
      founding_loan_annual_rate_basis_points: number;
      founding_loan_term_days: number;
      founding_loan_installment_count: number;
      baseline_daily_obligation_minor: unknown;
      forecast_horizon_days: number;
      assumptions: unknown;
    }>`SELECT w.id AS ruleset_id, w.version AS ruleset_version,
      r.id AS release_id, r.version AS release_version,
      b.id AS balance_id, b.version AS balance_version, b.founder_equity_minor,
      b.founding_loan_principal_minor, b.founding_loan_annual_rate_basis_points,
      b.founding_loan_term_days, b.founding_loan_installment_count,
      b.baseline_daily_obligation_minor, b.forecast_horizon_days, b.assumptions
      FROM world_rulesets w
      JOIN catalog_releases r ON r.id = w.catalog_release_id AND r.status = 'published'
      JOIN founding_balance_versions b ON b.world_ruleset_id = w.id AND b.status = 'active'
      WHERE w.version = ${selection.worldRulesetVersion} AND w.status = 'active'`.execute(database);
    const rule = rules.rows[0];
    if (!rule) {
      throw new FoundingDomainError(
        "inactive_world_ruleset",
        "The selected published world ruleset and founding balance are not active.",
      );
    }
    const airportResult = await sql<{
      id: string;
      iata_code: string;
      name: string;
      country_code: string;
    }>`SELECT a.id, a.iata_code, a.name, a.country_code
      FROM catalog_release_airports m
      JOIN curated_airports a ON a.id = m.airport_id
      WHERE m.release_id = ${rule.release_id}::uuid
        AND a.iata_code = ${selection.principalBaseIataCode}`.execute(database);
    const airport = airportResult.rows[0];
    if (!airport) {
      throw new FoundingDomainError(
        "invalid_principal_base",
        "Principal base is not a playable airport in the selected published catalog.",
      );
    }
    if (airport.country_code.trim() !== selection.homeJurisdiction) {
      throw new FoundingDomainError(
        "airport_jurisdiction_mismatch",
        "Principal base airport must be located in the airline home jurisdiction.",
      );
    }
    const existingName = await sql<{ exists: boolean }>`SELECT EXISTS (
      SELECT 1 FROM airlines a JOIN game_worlds g ON g.id = a.game_world_id
      WHERE g.world_ruleset_id = ${rule.ruleset_id}::uuid
        AND a.normalized_name = ${normalizedName}) AS exists`.execute(database);
    if (existingName.rows[0]?.exists) {
      throw new FoundingDomainError(
        "airline_name_unavailable",
        "The normalized fictional airline name is unavailable in this game world.",
      );
    }
    const balance: FoundingBalance = {
      id: rule.balance_id,
      version: rule.balance_version,
      worldRulesetId: rule.ruleset_id,
      founderEquityMinor: exactValue(
        rule.founder_equity_minor,
        selection.reportingCurrency,
        "Founder equity",
      ),
      loanPrincipalMinor: exactValue(
        rule.founding_loan_principal_minor,
        selection.reportingCurrency,
        "Founding loan",
      ),
      loanAnnualRateBasisPoints: rule.founding_loan_annual_rate_basis_points,
      loanTermDays: rule.founding_loan_term_days,
      loanInstallmentCount: rule.founding_loan_installment_count,
      baselineDailyObligationMinor: exactValue(
        rule.baseline_daily_obligation_minor,
        selection.reportingCurrency,
        "Baseline daily obligation",
      ),
      forecastHorizonDays: rule.forecast_horizon_days,
      assumptions: assumptions(rule.assumptions),
    };
    return {
      rulesetId: rule.ruleset_id,
      rulesetVersion: rule.ruleset_version,
      releaseId: rule.release_id,
      releaseVersion: rule.release_version,
      balance,
      airport: {
        id: airport.id,
        iataCode: airport.iata_code.trim(),
        name: airport.name,
        countryCode: airport.country_code.trim(),
      },
      normalizedName,
    };
  }

  public async preview(
    playerAccountId: string,
    selection: FoundingSelection,
    now: Date,
  ): Promise<FoundingPreview> {
    const active = await sql<{ exists: boolean }>`SELECT EXISTS (
      SELECT 1 FROM careers WHERE player_account_id = ${playerAccountId}::uuid AND status = 'active'
    ) AS exists`.execute(this.database);
    if (active.rows[0]?.exists) {
      throw new FoundingDomainError(
        "active_airline_exists",
        "A player account may have only one active slice-one airline.",
      );
    }
    return buildPreview(
      selection,
      await this.context(this.database, playerAccountId, selection, false),
      now,
    );
  }

  public async confirm(
    playerAccountId: string,
    selection: FoundingSelection,
    idempotencyKey: string,
    now: Date,
  ): Promise<FoundingConfirmation> {
    const hash = requestHash(selection);
    try {
      return await runInTransaction(
        this.database,
        async (transaction) => {
          const scope = `airline-founding:${playerAccountId}`;
          const inserted = await sql<{ inserted: boolean }>`INSERT INTO idempotency_commands
            (scope, idempotency_key, command_type, request_hash, expires_at)
            VALUES (${scope}, ${idempotencyKey}, 'airline_founding', ${hash},
              CURRENT_TIMESTAMP + INTERVAL '30 days')
            ON CONFLICT (scope, idempotency_key) DO NOTHING RETURNING true AS inserted`.execute(
            transaction,
          );
          const idempotency = await sql<{
            request_hash: string;
            state: string;
            response_body: unknown;
          }>`SELECT request_hash, state, response_body FROM idempotency_commands
            WHERE scope = ${scope} AND idempotency_key = ${idempotencyKey} FOR UPDATE`.execute(
            transaction,
          );
          const command = idempotency.rows[0];
          if (!command) throw new Error("Founding idempotency record was not persisted.");
          if (command.request_hash.trim() !== hash) {
            throw new FoundingDomainError(
              "idempotency_conflict",
              "Idempotency key was reused with a different founding selection.",
            );
          }
          if (inserted.rows.length === 0 && command.state === "completed") {
            return command.response_body as FoundingConfirmation;
          }
          await this.stage("idempotency");

          const context = await this.context(transaction, playerAccountId, selection, true);
          const existing = await sql<{ exists: boolean }>`SELECT EXISTS (
            SELECT 1 FROM careers
            WHERE player_account_id = ${playerAccountId}::uuid AND status = 'active'
          ) AS exists`.execute(transaction);
          if (existing.rows[0]?.exists) {
            throw new FoundingDomainError(
              "active_airline_exists",
              "A player account may have only one active slice-one airline.",
            );
          }
          const worldCode = `slice-one-${context.rulesetVersion}`.replace(/[^a-z0-9-]/g, "-");
          await sql`INSERT INTO game_worlds
            (code, catalog_release_id, world_ruleset_id)
            VALUES (${worldCode}, ${context.releaseId}::uuid, ${context.rulesetId}::uuid)
            ON CONFLICT (code) DO NOTHING`.execute(transaction);
          const world = await sql<{ id: string }>`SELECT id FROM game_worlds
            WHERE code = ${worldCode} AND world_ruleset_id = ${context.rulesetId}::uuid`.execute(
            transaction,
          );
          const worldId = world.rows[0]?.id;
          if (!worldId) throw new Error("Game world was not created.");

          const career = await sql<{ id: string }>`INSERT INTO careers
            (player_account_id, game_world_id, catalog_release_id, world_ruleset_id,
             founding_balance_version_id, founded_at)
            VALUES (${playerAccountId}::uuid, ${worldId}::uuid, ${context.releaseId}::uuid,
              ${context.rulesetId}::uuid, ${context.balance.id}::uuid,
              ${now.toISOString()}::timestamptz) RETURNING id`.execute(transaction);
          const careerId = career.rows[0]?.id;
          if (!careerId) throw new Error("Career was not created.");
          await this.stage("career");

          const airlineId = randomUUID();
          await sql`INSERT INTO airlines
            (id, career_id, game_world_id, name, normalized_name, fictional_identity_confirmed, home_jurisdiction,
             principal_base_airport_id, reporting_currency, brand, founded_at)
            VALUES (${airlineId}::uuid, ${careerId}::uuid, ${worldId}::uuid,
              ${selection.airlineName.normalize("NFKC").trim().replace(/\s+/g, " ")},
              ${context.normalizedName}, true, ${selection.homeJurisdiction}, ${context.airport.id}::uuid,
              ${selection.reportingCurrency}, ${JSON.stringify(selection.brand)}::jsonb,
              ${now.toISOString()}::timestamptz)`.execute(transaction);
          await this.stage("airline");

          const station = await sql<{ id: string }>`INSERT INTO airline_stations
            (airline_id, airport_id, station_role, service_model, opened_at)
            VALUES (${airlineId}::uuid, ${context.airport.id}::uuid, 'principal_base', 'outsourced',
              ${now.toISOString()}::timestamptz) RETURNING id`.execute(transaction);
          const stationId = station.rows[0]?.id;
          if (!stationId) throw new Error("Principal-base station was not created.");
          await this.stage("station");

          const offer = await sql<{ id: string }>`INSERT INTO founder_financing_offers
            (career_id, balance_version_id, currency, founder_equity_minor,
             loan_principal_minor, annual_rate_basis_points, term_days, installment_count,
             selection, selected_at)
            VALUES (${careerId}::uuid, ${context.balance.id}::uuid, ${selection.reportingCurrency},
              ${context.balance.founderEquityMinor.toString()}::bigint,
              ${context.balance.loanPrincipalMinor.toString()}::bigint,
              ${context.balance.loanAnnualRateBasisPoints}, ${context.balance.loanTermDays},
              ${context.balance.loanInstallmentCount},
              ${selection.acceptFoundingLoan ? "accepted" : "declined"},
              ${now.toISOString()}::timestamptz) RETURNING id`.execute(transaction);
          const offerId = offer.rows[0]?.id;
          if (!offerId) throw new Error("Founder financing selection was not created.");
          let loanId: string | undefined;
          const loanSchedule = createFoundingLoanSchedule(
            context.balance.loanPrincipalMinor,
            context.balance.loanAnnualRateBasisPoints,
            context.balance.loanTermDays,
            context.balance.loanInstallmentCount,
            now,
          );
          if (selection.acceptFoundingLoan) {
            const loan = await sql<{ id: string }>`INSERT INTO founding_loans
              (financing_offer_id, airline_id, currency, original_principal_minor,
               outstanding_principal_minor, annual_rate_basis_points, term_days,
               installment_count, starts_at, matures_at)
              VALUES (${offerId}::uuid, ${airlineId}::uuid, ${selection.reportingCurrency},
                ${context.balance.loanPrincipalMinor.toString()}::bigint,
                ${context.balance.loanPrincipalMinor.toString()}::bigint,
                ${context.balance.loanAnnualRateBasisPoints}, ${context.balance.loanTermDays},
                ${context.balance.loanInstallmentCount}, ${now.toISOString()}::timestamptz,
                ${loanSchedule.at(-1)?.dueAt.toISOString()}::timestamptz) RETURNING id`.execute(
              transaction,
            );
            loanId = loan.rows[0]?.id;
            if (!loanId) throw new Error("Founding loan was not created.");
            for (const installment of loanSchedule) {
              await sql`INSERT INTO founding_loan_schedule
                (loan_id, installment_number, due_at, principal_minor, interest_minor)
                VALUES (${loanId}::uuid, ${installment.installmentNumber},
                  ${installment.dueAt.toISOString()}::timestamptz,
                  ${installment.principalMinor.toString()}::bigint,
                  ${installment.interestMinor.toString()}::bigint)`.execute(transaction);
            }
          }
          await this.stage("financing");

          await new KyselyIdentityRepository(transaction).bindResourceOwnership({
            resourceType: "airline",
            resourceId: airlineId,
            playerAccountId,
          });
          await this.stage("ownership");

          const ledger = new KyselyLedgerRepository(transaction, true);
          const year = now.getUTCFullYear();
          const book = await ledger.createBook({
            ownerType: "airline",
            ownerId: airlineId,
            reportingCurrency: selection.reportingCurrency,
            templateCode: "airline-career",
            templateVersion: 1,
            firstPeriod: {
              key: String(year),
              startsOn: `${year}-01-01`,
              endsOn: `${year}-12-31`,
            },
          });
          await this.stage("ledger_book");
          await ledger.post({
            ledgerBookId: book.id,
            idempotencyKey: `${idempotencyKey}:founder-equity`,
            commandType: "equity",
            cashFlowActivity: "financing",
            description: "Standardized founder equity",
            occurredAt: now,
            accountingPeriodId: book.firstAccountingPeriodId,
            transactionCurrency: selection.reportingCurrency,
            reportingCurrency: selection.reportingCurrency,
            postings: [
              {
                accountCode: "1000",
                side: "debit",
                transactionAmountMinor: context.balance.founderEquityMinor,
                reportingAmountMinor: context.balance.founderEquityMinor,
                dimensions: { airlineId, stationId },
              },
              {
                accountCode: "3000",
                side: "credit",
                transactionAmountMinor: context.balance.founderEquityMinor,
                reportingAmountMinor: context.balance.founderEquityMinor,
                dimensions: { airlineId, stationId },
              },
            ],
          });
          await this.stage("equity");
          if (selection.acceptFoundingLoan && loanId) {
            await ledger.post({
              ledgerBookId: book.id,
              idempotencyKey: `${idempotencyKey}:founding-loan`,
              commandType: "loan",
              cashFlowActivity: "financing",
              description: "Accepted founding loan proceeds",
              occurredAt: now,
              accountingPeriodId: book.firstAccountingPeriodId,
              transactionCurrency: selection.reportingCurrency,
              reportingCurrency: selection.reportingCurrency,
              postings: [
                {
                  accountCode: "1000",
                  side: "debit",
                  transactionAmountMinor: context.balance.loanPrincipalMinor,
                  reportingAmountMinor: context.balance.loanPrincipalMinor,
                  dimensions: { airlineId, contractId: loanId },
                },
                {
                  accountCode: "2200",
                  side: "credit",
                  transactionAmountMinor: context.balance.loanPrincipalMinor,
                  reportingAmountMinor: context.balance.loanPrincipalMinor,
                  dimensions: { airlineId, contractId: loanId },
                },
              ],
            });
          }
          await this.stage("loan");

          await sql`INSERT INTO outbox_events
            (aggregate_type, aggregate_id, aggregate_version, event_type, payload)
            VALUES ('airline', ${airlineId}::uuid, 1, 'airline.founded.v1',
              ${JSON.stringify({
                airlineId,
                careerId,
                gameWorldId: worldId,
                catalogReleaseVersion: context.releaseVersion,
                worldRulesetVersion: context.rulesetVersion,
                foundingBalanceVersion: context.balance.version,
                nextStep: "select_founder_aircraft",
              })}::jsonb)`.execute(transaction);
          await this.stage("outbox");

          const result: FoundingConfirmation = {
            ...buildPreview(selection, context, now),
            careerId,
            airlineId,
            stationId,
            ledgerBookId: book.id,
            careerStatus: "active",
            foundedAt: now.toISOString(),
          };
          await sql`UPDATE idempotency_commands SET state = 'completed', response_status = 201,
            response_body = ${JSON.stringify(result)}::jsonb, updated_at = CURRENT_TIMESTAMP
            WHERE scope = ${scope} AND idempotency_key = ${idempotencyKey}`.execute(transaction);
          return result;
        },
        { isolationLevel: "serializable", maximumAttempts: 5 },
      );
    } catch (error) {
      if (error instanceof FoundingDomainError) throw error;
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        const constraint =
          "constraint" in error && typeof error.constraint === "string" ? error.constraint : "";
        if (constraint.includes("normalized_name")) {
          throw new FoundingDomainError(
            "airline_name_unavailable",
            "The normalized fictional airline name is unavailable in this game world.",
          );
        }
        if (constraint.includes("careers_one_active")) {
          throw new FoundingDomainError(
            "active_airline_exists",
            "A player account may have only one active slice-one airline.",
          );
        }
      }
      throw error;
    }
  }

  public async summary(playerAccountId: string, airlineId: string): Promise<AirlineSummary> {
    const result = await sql<{
      career_id: string;
      airline_id: string;
      name: string;
      normalized_name: string;
      brand: unknown;
      career_status: AirlineSummary["careerStatus"];
      airline_status: AirlineSummary["airlineStatus"];
      home_jurisdiction: string;
      reporting_currency: CurrencyCode;
      release_version: string;
      ruleset_version: string;
      balance_version: string;
      airport_id: string;
      iata_code: string;
      airport_name: string;
      country_code: string;
      cash_minor: string;
      equity_minor: string;
      loan_minor: string;
    }>`SELECT c.id AS career_id, a.id AS airline_id, a.name, a.normalized_name, a.brand,
      c.status AS career_status, a.status AS airline_status, a.home_jurisdiction,
      a.reporting_currency, cr.version AS release_version, w.version AS ruleset_version,
      b.version AS balance_version, p.id AS airport_id, p.iata_code, p.name AS airport_name,
      p.country_code,
      COALESCE((SELECT sum(CASE lp.side WHEN 'debit' THEN lp.reporting_amount_minor
        ELSE -lp.reporting_amount_minor END) FROM ledger_postings lp
        JOIN ledger_accounts la ON la.id = lp.account_id
        JOIN journal_entries j ON j.id = lp.journal_entry_id AND j.status = 'posted'
        JOIN ledger_books lb ON lb.id = j.ledger_book_id
        WHERE lb.owner_type = 'airline' AND lb.owner_id = a.id AND la.code = '1000'), 0)::text AS cash_minor,
      COALESCE((SELECT sum(CASE lp.side WHEN 'credit' THEN lp.reporting_amount_minor
        ELSE -lp.reporting_amount_minor END) FROM ledger_postings lp
        JOIN ledger_accounts la ON la.id = lp.account_id
        JOIN journal_entries j ON j.id = lp.journal_entry_id AND j.status = 'posted'
        JOIN ledger_books lb ON lb.id = j.ledger_book_id
        WHERE lb.owner_type = 'airline' AND lb.owner_id = a.id AND la.code = '3000'), 0)::text AS equity_minor,
      COALESCE((SELECT sum(CASE lp.side WHEN 'credit' THEN lp.reporting_amount_minor
        ELSE -lp.reporting_amount_minor END) FROM ledger_postings lp
        JOIN ledger_accounts la ON la.id = lp.account_id
        JOIN journal_entries j ON j.id = lp.journal_entry_id AND j.status = 'posted'
        JOIN ledger_books lb ON lb.id = j.ledger_book_id
        WHERE lb.owner_type = 'airline' AND lb.owner_id = a.id AND la.code = '2200'), 0)::text AS loan_minor
      FROM airlines a
      JOIN careers c ON c.id = a.career_id
      JOIN catalog_releases cr ON cr.id = c.catalog_release_id
      JOIN world_rulesets w ON w.id = c.world_ruleset_id
      JOIN founding_balance_versions b ON b.id = c.founding_balance_version_id
      JOIN curated_airports p ON p.id = a.principal_base_airport_id
      JOIN resource_ownerships o ON o.resource_type = 'airline' AND o.resource_id = a.id
        AND o.player_account_id = ${playerAccountId}::uuid
      WHERE a.id = ${airlineId}::uuid`.execute(this.database);
    const row = result.rows[0];
    if (!row) {
      throw new FoundingDomainError("founding_not_found", "The airline summary is unavailable.");
    }
    return {
      careerId: row.career_id,
      airlineId: row.airline_id,
      name: row.name,
      normalizedAirlineName: row.normalized_name,
      brand: row.brand as AirlineBrand,
      careerStatus: row.career_status,
      airlineStatus: row.airline_status,
      homeJurisdiction: row.home_jurisdiction.trim(),
      reportingCurrency: row.reporting_currency,
      catalogReleaseVersion: row.release_version,
      worldRulesetVersion: row.ruleset_version,
      foundingBalanceVersion: row.balance_version,
      principalBase: {
        airportId: row.airport_id,
        iataCode: row.iata_code.trim(),
        name: row.airport_name,
        countryCode: row.country_code.trim(),
        stationServiceModel: "outsourced",
      },
      cashMinor: row.cash_minor,
      equityMinor: row.equity_minor,
      loanLiabilityMinor: row.loan_minor,
      nextStep: "select_founder_aircraft",
      nextStepGuidance:
        "Choose one founder-aircraft lease package next. No aircraft or lease has been created or accepted yet.",
    };
  }
}
