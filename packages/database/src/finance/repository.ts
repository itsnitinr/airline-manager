import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import type {
  CreateLedgerBookCommand,
  CurrencyCode,
  ExchangeRateImport,
  ExchangeRateRepository,
  ExactExchangeRate,
  FinanceOverview,
  FinanceReadRepository,
  FinanceStatements,
  ImportedExchangeRates,
  JournalPage,
  LedgerBook,
  LedgerReportRow,
  LedgerReports,
  LedgerRepository,
  PostJournalCommand,
  PostedJournal,
  PostingLine,
} from "@airline-manager/domain";
import { assertBalancedPostings, assertReportingSnapshots } from "@airline-manager/domain";
import type { Database } from "../database.js";
import type { DB } from "../generated/database.js";
import { runInTransaction } from "../transactions.js";

function requestHash(value: unknown): string {
  const canonicalize = (item: unknown): unknown => {
    if (typeof item === "bigint") return item.toString();
    if (Array.isArray(item)) return item.map(canonicalize);
    if (typeof item === "object" && item !== null)
      return Object.fromEntries(
        Object.entries(item)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, canonicalize(nested)]),
      );
    return item;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

type JournalInsertOptions = Readonly<{ reversalOf?: string }>;

export class KyselyLedgerRepository implements LedgerRepository {
  public constructor(
    private readonly database: Database | Transaction<DB>,
    private readonly transactionScoped = false,
  ) {}

  private run<TResult>(
    callback: (transaction: Transaction<DB>) => Promise<TResult>,
    options: Readonly<{
      isolationLevel?: "read committed" | "repeatable read" | "serializable";
      maximumAttempts?: number;
    }> = {},
  ): Promise<TResult> {
    if (this.transactionScoped) return callback(this.database as Transaction<DB>);
    return runInTransaction(this.database as Kysely<DB>, callback, options);
  }

  public async createBook(command: CreateLedgerBookCommand): Promise<LedgerBook> {
    return this.run(
      async (transaction) => {
        const version = await sql<{
          id: string;
        }>`SELECT v.id FROM chart_of_accounts_template_versions v
        JOIN chart_of_accounts_templates t ON t.id = v.template_id
        WHERE t.code = ${command.templateCode} AND v.version = ${command.templateVersion}
          AND v.status = 'published'`.execute(transaction);
        const templateVersionId = version.rows[0]?.id;
        if (!templateVersionId)
          throw new Error("Published chart-of-accounts template version not found.");
        const book = await sql<{ id: string }>`INSERT INTO ledger_books
        (owner_type, owner_id, reporting_currency, template_version_id)
        VALUES (${command.ownerType}, ${command.ownerId}::uuid, ${command.reportingCurrency}, ${templateVersionId}::uuid)
        RETURNING id`.execute(transaction);
        const id = book.rows[0]?.id;
        if (!id) throw new Error("Ledger book was not created.");
        await sql`INSERT INTO ledger_accounts
        (ledger_book_id, template_version_id, code, name, account_type, normal_balance,
         cash_flow_activity, is_cash, is_fx_clearing)
        SELECT ${id}::uuid, template_version_id, code, name, account_type, normal_balance,
          cash_flow_activity, is_cash, is_fx_clearing
        FROM chart_of_accounts_template_accounts WHERE template_version_id = ${templateVersionId}::uuid`.execute(
          transaction,
        );
        const period = await sql<{ id: string }>`INSERT INTO accounting_periods
        (ledger_book_id, period_key, starts_on, ends_on)
        VALUES (${id}::uuid, ${command.firstPeriod.key}, ${command.firstPeriod.startsOn}::date,
          ${command.firstPeriod.endsOn}::date) RETURNING id`.execute(transaction);
        const firstAccountingPeriodId = period.rows[0]?.id;
        if (!firstAccountingPeriodId) throw new Error("First accounting period was not created.");
        return {
          id,
          ownerType: command.ownerType,
          ownerId: command.ownerId,
          reportingCurrency: command.reportingCurrency,
          templateVersion: command.templateVersion,
          firstAccountingPeriodId,
        };
      },
      { isolationLevel: "serializable" },
    );
  }

  public post(command: PostJournalCommand): Promise<PostedJournal> {
    assertBalancedPostings(command.postings);
    assertReportingSnapshots(command);
    return this.postInternal(command, {});
  }

  private async postInternal(
    command: PostJournalCommand,
    options: JournalInsertOptions,
  ): Promise<PostedJournal> {
    const hash = requestHash({
      ...command,
      occurredAt: command.occurredAt.toISOString(),
      reversalOf: options.reversalOf,
    });
    return this.run(
      async (transaction) => {
        await sql`SELECT id FROM ledger_books WHERE id = ${command.ledgerBookId}::uuid FOR UPDATE`.execute(
          transaction,
        );
        const scope = `ledger:${command.ledgerBookId}`;
        const inserted = await sql<{ inserted: boolean }>`INSERT INTO idempotency_commands
        (scope, idempotency_key, command_type, request_hash, expires_at)
        VALUES (${scope}, ${command.idempotencyKey}, ${command.commandType}, ${hash},
          CURRENT_TIMESTAMP + INTERVAL '7 days')
        ON CONFLICT (scope, idempotency_key) DO NOTHING RETURNING true AS inserted`.execute(
          transaction,
        );
        const existing = await sql<{
          request_hash: string;
          state: string;
          response_body: unknown;
        }>`SELECT request_hash, state, response_body
        FROM idempotency_commands WHERE scope = ${scope} AND idempotency_key = ${command.idempotencyKey}
        FOR UPDATE`.execute(transaction);
        const row = existing.rows[0];
        if (!row) throw new Error("Idempotency command was not persisted.");
        if (row.request_hash.trim() !== hash)
          throw new Error("Idempotency key was reused with a different request.");
        if (inserted.rows.length === 0 && row.state === "completed") {
          const response = row.response_body as { journalEntryId: string; postedAt: string };
          return {
            journalEntryId: response.journalEntryId,
            status: "posted",
            postedAt: new Date(response.postedAt),
          };
        }

        const journalId = randomUUID();
        await sql`INSERT INTO journal_entries
        (id, ledger_book_id, accounting_period_id, command_type, entry_kind, cash_flow_activity,
         transaction_currency, reporting_currency, exchange_rate_import_id,
         exchange_rate_numerator, exchange_rate_denominator, description, occurred_at,
         reversal_of_journal_entry_id)
        VALUES (${journalId}::uuid, ${command.ledgerBookId}::uuid, ${command.accountingPeriodId}::uuid,
          ${command.commandType}, ${options.reversalOf ? "reversal" : (command.entryKind ?? "standard")},
          ${command.cashFlowActivity ?? (["equity", "loan", "lease"].includes(command.commandType) ? "financing" : "operating")},
          ${command.transactionCurrency}, ${command.reportingCurrency}, ${command.exchangeRateImportId ?? null}::uuid,
          ${command.exchangeRateNumerator?.toString() ?? null}::bigint,
          ${command.exchangeRateDenominator?.toString() ?? null}::bigint, ${command.description},
          ${command.occurredAt.toISOString()}::timestamptz, ${options.reversalOf ?? null}::uuid)`.execute(
          transaction,
        );
        await this.insertPostings(transaction, journalId, command.ledgerBookId, command.postings);
        await sql`SELECT finalize_journal(${journalId}::uuid)`.execute(transaction);
        const finalized = await sql<{ posted_at: Date }>`SELECT posted_at FROM journal_entries
        WHERE id = ${journalId}::uuid`.execute(transaction);
        const postedAt = finalized.rows[0]?.posted_at;
        if (!postedAt) throw new Error("Journal finalization did not record posting time.");
        const sequence = await sql<{
          version: string;
        }>`SELECT count(*)::text AS version FROM journal_entries
        WHERE ledger_book_id = ${command.ledgerBookId}::uuid AND status = 'posted'`.execute(
          transaction,
        );
        await sql`INSERT INTO outbox_events
        (aggregate_type, aggregate_id, aggregate_version, event_type, payload)
        VALUES ('ledger_book', ${command.ledgerBookId}::uuid, ${sequence.rows[0]?.version ?? "1"}::bigint,
          'finance.journal_posted.v1', ${JSON.stringify({ journalEntryId: journalId, commandType: command.commandType })}::jsonb)`.execute(
          transaction,
        );
        const response = { journalEntryId: journalId, postedAt: postedAt.toISOString() };
        await sql`UPDATE idempotency_commands SET state = 'completed', response_status = 201,
        response_body = ${JSON.stringify(response)}::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE scope = ${scope} AND idempotency_key = ${command.idempotencyKey}`.execute(
          transaction,
        );
        return { journalEntryId: journalId, status: "posted", postedAt };
      },
      { isolationLevel: "serializable", maximumAttempts: 5 },
    );
  }

  private async insertPostings(
    transaction: Transaction<DB>,
    journalId: string,
    ledgerBookId: string,
    postings: readonly PostingLine[],
  ): Promise<void> {
    for (const [index, posting] of postings.entries()) {
      await sql`INSERT INTO ledger_postings
        (journal_entry_id, account_id, line_number, side, transaction_amount_minor,
         reporting_amount_minor, airline_id, aircraft_id, route_id, flight_id, station_id,
         contract_id, memo)
        SELECT ${journalId}::uuid, id, ${index + 1}, ${posting.side},
          ${posting.transactionAmountMinor.toString()}::bigint, ${posting.reportingAmountMinor.toString()}::bigint,
          ${posting.dimensions?.airlineId ?? null}::uuid, ${posting.dimensions?.aircraftId ?? null}::uuid,
          ${posting.dimensions?.routeId ?? null}::uuid, ${posting.dimensions?.flightId ?? null}::uuid,
          ${posting.dimensions?.stationId ?? null}::uuid, ${posting.dimensions?.contractId ?? null}::uuid,
          ${posting.memo ?? null}
        FROM ledger_accounts WHERE ledger_book_id = ${ledgerBookId}::uuid AND code = ${posting.accountCode}`.execute(
        transaction,
      );
    }
    const count = await sql<{ count: string }>`SELECT count(*)::text AS count FROM ledger_postings
      WHERE journal_entry_id = ${journalId}::uuid`.execute(transaction);
    if (Number(count.rows[0]?.count) !== postings.length)
      throw new Error("A posting account code does not exist in the ledger book.");
  }

  public async reverse(
    ledgerBookId: string,
    journalEntryId: string,
    accountingPeriodId: string,
    occurredAt: Date,
    idempotencyKey: string,
    description: string,
  ): Promise<PostedJournal> {
    const original = await sql<{
      command_type: PostJournalCommand["commandType"];
      transaction_currency: CurrencyCode;
      reporting_currency: CurrencyCode;
      exchange_rate_import_id: string | null;
      exchange_rate_numerator: string | null;
      exchange_rate_denominator: string | null;
    }>`SELECT command_type, transaction_currency, reporting_currency,
        exchange_rate_import_id, exchange_rate_numerator, exchange_rate_denominator FROM journal_entries
        WHERE id = ${journalEntryId}::uuid AND ledger_book_id = ${ledgerBookId}::uuid AND status = 'posted'`.execute(
      this.database,
    );
    const source = original.rows[0];
    if (!source) throw new Error("Posted journal to reverse was not found.");
    const lines = await sql<{
      account_code: string;
      side: "debit" | "credit";
      transaction_amount_minor: string;
      reporting_amount_minor: string;
      airline_id: string | null;
      aircraft_id: string | null;
      route_id: string | null;
      flight_id: string | null;
      station_id: string | null;
      contract_id: string | null;
      memo: string | null;
    }>`
      SELECT a.code AS account_code, p.side, p.transaction_amount_minor, p.reporting_amount_minor,
        p.airline_id, p.aircraft_id, p.route_id, p.flight_id, p.station_id, p.contract_id, p.memo
      FROM ledger_postings p JOIN ledger_accounts a ON a.id = p.account_id
      WHERE p.journal_entry_id = ${journalEntryId}::uuid ORDER BY p.line_number`.execute(
      this.database,
    );
    const postings: PostingLine[] = lines.rows.map((line) => ({
      accountCode: line.account_code,
      side: line.side === "debit" ? "credit" : "debit",
      transactionAmountMinor: BigInt(line.transaction_amount_minor),
      reportingAmountMinor: BigInt(line.reporting_amount_minor),
      dimensions: Object.fromEntries(
        Object.entries({
          airlineId: line.airline_id,
          aircraftId: line.aircraft_id,
          routeId: line.route_id,
          flightId: line.flight_id,
          stationId: line.station_id,
          contractId: line.contract_id,
        }).filter(([, value]) => value !== null),
      ),
      ...(line.memo ? { memo: line.memo } : {}),
    }));
    const command: PostJournalCommand = {
      ledgerBookId,
      idempotencyKey,
      commandType: "adjustment",
      description,
      occurredAt,
      accountingPeriodId,
      transactionCurrency: source.transaction_currency,
      reportingCurrency: source.reporting_currency,
      postings,
      ...(source.exchange_rate_import_id
        ? {
            exchangeRateImportId: source.exchange_rate_import_id,
            exchangeRateNumerator: BigInt(source.exchange_rate_numerator ?? "0"),
            exchangeRateDenominator: BigInt(source.exchange_rate_denominator ?? "0"),
          }
        : {}),
    };
    return this.postInternal(command, { reversalOf: journalEntryId });
  }

  public async closePeriod(accountingPeriodId: string, lock = false): Promise<void> {
    await this.run(
      async (transaction) => {
        const period = await sql<{
          ledger_book_id: string;
        }>`SELECT ledger_book_id FROM accounting_periods
        WHERE id = ${accountingPeriodId}::uuid FOR UPDATE`.execute(transaction);
        const ledgerBookId = period.rows[0]?.ledger_book_id;
        if (!ledgerBookId) throw new Error("Accounting period was not found.");
        await sql`SELECT id FROM ledger_books WHERE id = ${ledgerBookId}::uuid FOR UPDATE`.execute(
          transaction,
        );
        await sql`UPDATE accounting_periods SET status = ${lock ? "locked" : "closed"},
        closed_at = CURRENT_TIMESTAMP WHERE id = ${accountingPeriodId}::uuid AND status = 'open'`.execute(
          transaction,
        );
      },
      { isolationLevel: "serializable" },
    );
  }

  public async reports(ledgerBookId: string): Promise<LedgerReports> {
    const read = async (view: string, category: string): Promise<LedgerReportRow[]> => {
      const result = await sql<{
        account_type?: string;
        cash_flow_activity?: string;
        code?: string;
        name?: string;
        transaction_currency: CurrencyCode;
        transaction_amount_minor: string;
        reporting_amount_minor: string;
      }>`
        SELECT * FROM ${sql.table(view)} WHERE ledger_book_id = ${ledgerBookId}::uuid
        ORDER BY transaction_currency`.execute(this.database);
      return result.rows.map((row) => ({
        category: row.account_type ?? row.cash_flow_activity ?? category,
        ...(row.code ? { accountCode: row.code } : {}),
        ...(row.name ? { accountName: row.name } : {}),
        transactionCurrency: row.transaction_currency,
        transactionAmountMinor: BigInt(row.transaction_amount_minor),
        reportingAmountMinor: BigInt(row.reporting_amount_minor),
      }));
    };
    const [cash, profitAndLoss, balanceSheet, cashFlow] = await Promise.all([
      read("ledger_cash_report", "cash"),
      read("ledger_profit_and_loss_report", "profit_and_loss"),
      read("ledger_balance_sheet_report", "balance_sheet"),
      read("ledger_cash_flow_report", "cash_flow"),
    ]);
    return { cash, profitAndLoss, balanceSheet, cashFlow };
  }
}

export class KyselyFinanceReadRepository implements FinanceReadRepository {
  public constructor(private readonly database: Database) {}

  private async book(playerAccountId: string, airlineId: string) {
    const result = await sql<{ id: string; reporting_currency: CurrencyCode }>`SELECT book.id,
      book.reporting_currency FROM ledger_books book
      JOIN resource_ownerships ownership ON ownership.resource_type='airline'
        AND ownership.resource_id=book.owner_id
      WHERE book.owner_type='airline' AND book.owner_id=${airlineId}::uuid
        AND ownership.player_account_id=${playerAccountId}::uuid`.execute(this.database);
    const row = result.rows[0];
    if (!row) throw new Error("Finance report is unavailable.");
    return row;
  }

  public async overview(
    playerAccountId: string,
    airlineId: string,
    asOf: Date,
  ): Promise<FinanceOverview> {
    const book = await this.book(playerAccountId, airlineId);
    const horizon = new Date(asOf.getTime() + 30 * 86_400_000);
    const [cash, obligations, routes, fuel, results, currencies] = await Promise.all([
      sql<{ amount: string }>`SELECT COALESCE(sum(CASE posting.side WHEN 'debit'
        THEN posting.reporting_amount_minor ELSE -posting.reporting_amount_minor END),0)::text AS amount
        FROM ledger_postings posting JOIN ledger_accounts account ON account.id=posting.account_id
        JOIN journal_entries journal ON journal.id=posting.journal_entry_id AND journal.status='posted'
        WHERE account.ledger_book_id=${book.id}::uuid AND account.is_cash
          AND journal.occurred_at<=${asOf.toISOString()}::timestamptz`.execute(this.database),
      sql<{
        id: string;
        kind: "founder_loan" | "operating_lease";
        due_at: Date;
        amount_minor: string;
        currency: CurrencyCode;
        status: "scheduled" | "overdue";
        source_id: string;
      }>`SELECT * FROM (
        SELECT loan.id::text || ':' || schedule.installment_number AS id,
          'founder_loan'::text AS kind, schedule.due_at, schedule.total_minor::text AS amount_minor,
          loan.currency, schedule.status, loan.id AS source_id
        FROM founding_loans loan JOIN founding_loan_schedule schedule ON schedule.loan_id=loan.id
        WHERE loan.airline_id=${airlineId}::uuid AND schedule.status IN ('scheduled','overdue')
        UNION ALL
        SELECT lease.id::text || ':' || schedule.payment_number AS id,
          'operating_lease'::text AS kind, schedule.due_at, schedule.amount_minor::text,
          lease.currency, schedule.status, lease.id AS source_id
        FROM operating_leases lease JOIN operating_lease_payment_schedule schedule
          ON schedule.lease_id=lease.id
        WHERE lease.airline_id=${airlineId}::uuid AND schedule.status IN ('scheduled','overdue')
      ) obligation WHERE due_at<=${horizon.toISOString()}::timestamptz ORDER BY due_at LIMIT 100`.execute(
        this.database,
      ),
      sql<{
        route_id: string;
        origin: string;
        destination: string;
        revenue: string;
        cost: string;
        result: string;
        flights: number;
      }>`SELECT route.id AS route_id, origin.iata_code AS origin,
        destination.iata_code AS destination,
        COALESCE(sum((snapshot.outcome->>'passengerRevenueMinor')::bigint),0)::text AS revenue,
        COALESCE(sum((snapshot.outcome->>'passengerRevenueMinor')::bigint
          - (snapshot.outcome->>'operatingResultMinor')::bigint),0)::text AS cost,
        COALESCE(sum((snapshot.outcome->>'operatingResultMinor')::bigint),0)::text AS result,
        count(snapshot.id)::integer AS flights
        FROM airline_routes route JOIN curated_airports origin ON origin.id=route.origin_airport_id
        JOIN curated_airports destination ON destination.id=route.destination_airport_id
        LEFT JOIN dated_flights flight ON flight.route_id=route.id
        LEFT JOIN settled_flight_snapshots snapshot ON snapshot.flight_id=flight.id
          AND snapshot.settled_at<=${asOf.toISOString()}::timestamptz
        WHERE route.airline_id=${airlineId}::uuid GROUP BY route.id, origin.iata_code,
          destination.iata_code ORDER BY result DESC, route.id LIMIT 100`.execute(this.database),
      sql<{
        on_hand_kg: string;
        inventory_value_minor: string;
        weighted_unit_cost_numerator: string;
        weighted_unit_cost_denominator: string;
      }>`SELECT on_hand_kg::text, inventory_value_minor::text,
        inventory_value_minor::text AS weighted_unit_cost_numerator,
        CASE WHEN on_hand_kg=0 THEN '1' ELSE on_hand_kg::text END AS weighted_unit_cost_denominator
        FROM airline_fuel_inventories WHERE airline_id=${airlineId}::uuid`.execute(this.database),
      sql<{
        flight_id: string;
        flight_number: string;
        route_id: string;
        settled_at: Date;
        revenue: string;
        cost: string;
        result: string;
      }>`SELECT flight.id AS flight_id, flight.flight_number, flight.route_id,
        snapshot.settled_at, snapshot.outcome->>'passengerRevenueMinor' AS revenue,
        ((snapshot.outcome->>'passengerRevenueMinor')::bigint
          - (snapshot.outcome->>'operatingResultMinor')::bigint)::text AS cost,
        snapshot.outcome->>'operatingResultMinor' AS result
        FROM settled_flight_snapshots snapshot JOIN dated_flights flight ON flight.id=snapshot.flight_id
        JOIN airline_routes route ON route.id=flight.route_id
        WHERE route.airline_id=${airlineId}::uuid AND snapshot.settled_at<=${asOf.toISOString()}::timestamptz
        ORDER BY snapshot.settled_at DESC LIMIT 12`.execute(this.database),
      sql<{ transaction_currency: CurrencyCode }>`SELECT DISTINCT journal.transaction_currency
        FROM journal_entries journal WHERE journal.ledger_book_id=${book.id}::uuid
        AND journal.status='posted' ORDER BY journal.transaction_currency`.execute(this.database),
    ]);
    const cashMinor = BigInt(cash.rows[0]?.amount ?? "0");
    const upcoming = obligations.rows.reduce((sum, row) => sum + BigInt(row.amount_minor), 0n);
    const daily = upcoming === 0n ? 0n : (upcoming + 29n) / 30n;
    return {
      asOf: asOf.toISOString(),
      reportingCurrency: book.reporting_currency,
      supportedTransactionCurrencies:
        currencies.rows.length > 0
          ? currencies.rows.map(({ transaction_currency }) => transaction_currency)
          : [book.reporting_currency],
      cashMinor: cashMinor.toString(),
      upcomingObligationsMinor: upcoming.toString(),
      runwayDays: daily > 0n ? Number(cashMinor / daily) : null,
      runwayHorizonDays: 30,
      runwayExplanation:
        daily > 0n
          ? "Cash divided by the average scheduled founder-loan and operating-lease obligations due in the next 30 days. Forecast operations are excluded."
          : "No founder-loan or operating-lease obligation is due in the next 30 days; a bounded obligation-only runway is not meaningful.",
      obligations: obligations.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        dueAt: row.due_at.toISOString(),
        amountMinor: row.amount_minor,
        currency: row.currency,
        status: row.status,
        sourceId: row.source_id,
      })),
      routeProfitability: routes.rows.map((row) => ({
        routeId: row.route_id,
        originIataCode: row.origin,
        destinationIataCode: row.destination,
        realizedRevenueMinor: row.revenue,
        realizedCostMinor: row.cost,
        operatingResultMinor: row.result,
        settledFlights: row.flights,
      })),
      fuel: {
        onHandKg: fuel.rows[0]?.on_hand_kg ?? "0",
        inventoryValueMinor: fuel.rows[0]?.inventory_value_minor ?? "0",
        weightedUnitCostNumerator: fuel.rows[0]?.weighted_unit_cost_numerator ?? "0",
        weightedUnitCostDenominator: fuel.rows[0]?.weighted_unit_cost_denominator ?? "1",
      },
      recentResults: results.rows.map((row) => ({
        flightId: row.flight_id,
        flightNumber: row.flight_number,
        routeId: row.route_id,
        settledAt: row.settled_at.toISOString(),
        revenueMinor: row.revenue,
        costMinor: row.cost,
        operatingResultMinor: row.result,
      })),
    };
  }

  public async statements(
    playerAccountId: string,
    airlineId: string,
    from: Date,
    to: Date,
  ): Promise<FinanceStatements> {
    const book = await this.book(playerAccountId, airlineId);
    type StatementRow = { code: string; name: string; account_type: string; amount: string };
    const [profitAndLoss, balanceSheet, cashFlow, balanceCheck, journalCheck, lifetimeEarnings] =
      await Promise.all([
        sql<StatementRow>`SELECT account.code, account.name, account.account_type,
          sum(CASE WHEN account.account_type='revenue' THEN CASE posting.side WHEN 'credit'
            THEN posting.reporting_amount_minor ELSE -posting.reporting_amount_minor END
            ELSE CASE posting.side WHEN 'debit' THEN posting.reporting_amount_minor
            ELSE -posting.reporting_amount_minor END END)::text AS amount
          FROM ledger_accounts account JOIN ledger_postings posting ON posting.account_id=account.id
          JOIN journal_entries journal ON journal.id=posting.journal_entry_id AND journal.status='posted'
          WHERE account.ledger_book_id=${book.id}::uuid AND account.account_type IN ('revenue','expense')
            AND journal.occurred_at>=${from.toISOString()}::timestamptz
            AND journal.occurred_at<${to.toISOString()}::timestamptz
          GROUP BY account.code, account.name, account.account_type ORDER BY account.code`.execute(
          this.database,
        ),
        sql<StatementRow>`SELECT account.code, account.name, account.account_type,
          sum(CASE WHEN account.normal_balance='debit' THEN CASE posting.side WHEN 'debit'
            THEN posting.reporting_amount_minor ELSE -posting.reporting_amount_minor END
            ELSE CASE posting.side WHEN 'credit' THEN posting.reporting_amount_minor
            ELSE -posting.reporting_amount_minor END END)::text AS amount
          FROM ledger_accounts account JOIN ledger_postings posting ON posting.account_id=account.id
          JOIN journal_entries journal ON journal.id=posting.journal_entry_id AND journal.status='posted'
          WHERE account.ledger_book_id=${book.id}::uuid AND account.account_type IN ('asset','liability','equity')
            AND journal.occurred_at<${to.toISOString()}::timestamptz
          GROUP BY account.code, account.name, account.account_type ORDER BY account.code`.execute(
          this.database,
        ),
        sql<{ activity: string; amount: string }>`SELECT journal.cash_flow_activity AS activity,
          sum(CASE posting.side WHEN 'debit' THEN posting.reporting_amount_minor
            ELSE -posting.reporting_amount_minor END)::text AS amount
          FROM ledger_postings posting JOIN ledger_accounts account ON account.id=posting.account_id
          JOIN journal_entries journal ON journal.id=posting.journal_entry_id AND journal.status='posted'
          WHERE account.ledger_book_id=${book.id}::uuid AND account.is_cash
            AND journal.occurred_at>=${from.toISOString()}::timestamptz
            AND journal.occurred_at<${to.toISOString()}::timestamptz
          GROUP BY journal.cash_flow_activity ORDER BY journal.cash_flow_activity`.execute(
          this.database,
        ),
        sql<{ difference: string }>`SELECT COALESCE(sum(CASE posting.side WHEN 'debit'
          THEN posting.reporting_amount_minor ELSE -posting.reporting_amount_minor END),0)::text AS difference
          FROM ledger_postings posting JOIN journal_entries journal ON journal.id=posting.journal_entry_id
          WHERE journal.ledger_book_id=${book.id}::uuid AND journal.status='posted'
            AND journal.occurred_at<${to.toISOString()}::timestamptz`.execute(this.database),
        sql<{ balanced: boolean }>`SELECT NOT EXISTS (SELECT 1 FROM journal_entries journal
          JOIN ledger_postings posting ON posting.journal_entry_id=journal.id
          WHERE journal.ledger_book_id=${book.id}::uuid AND journal.status='posted'
            AND journal.occurred_at<${to.toISOString()}::timestamptz GROUP BY journal.id
          HAVING sum(CASE posting.side WHEN 'debit' THEN posting.reporting_amount_minor
            ELSE -posting.reporting_amount_minor END)<>0) AS balanced`.execute(this.database),
        sql<{ amount: string }>`SELECT COALESCE(sum(CASE WHEN account.account_type='revenue'
          THEN CASE posting.side WHEN 'credit' THEN posting.reporting_amount_minor ELSE -posting.reporting_amount_minor END
          ELSE CASE posting.side WHEN 'debit' THEN -posting.reporting_amount_minor ELSE posting.reporting_amount_minor END END),0)::text AS amount
          FROM ledger_accounts account JOIN ledger_postings posting ON posting.account_id=account.id
          JOIN journal_entries journal ON journal.id=posting.journal_entry_id AND journal.status='posted'
          WHERE account.ledger_book_id=${book.id}::uuid AND account.account_type IN ('revenue','expense')
            AND journal.occurred_at<${to.toISOString()}::timestamptz`.execute(this.database),
      ]);
    const pnlRows = profitAndLoss.rows.map((row) => ({
      accountCode: row.code,
      accountName: row.name,
      group: row.account_type,
      amountMinor: row.amount,
    }));
    const bsRows = balanceSheet.rows.map((row) => ({
      accountCode: row.code,
      accountName: row.name,
      group: row.account_type,
      amountMinor: row.amount,
    }));
    const assets = balanceSheet.rows
      .filter(({ account_type }) => account_type === "asset")
      .reduce((sum, row) => sum + BigInt(row.amount), 0n);
    const liabilitiesEquity = balanceSheet.rows
      .filter(({ account_type }) => account_type !== "asset")
      .reduce((sum, row) => sum + BigInt(row.amount), 0n);
    const currentEarnings = BigInt(lifetimeEarnings.rows[0]?.amount ?? "0");
    const balanceDifference = assets - liabilitiesEquity - currentEarnings;
    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      asOf: new Date().toISOString(),
      reportingCurrency: book.reporting_currency,
      basis: "posted_double_entry_ledger",
      profitAndLoss: {
        rows: pnlRows,
        netIncomeMinor: pnlRows
          .reduce(
            (sum, row) => sum + BigInt(row.amountMinor) * (row.group === "revenue" ? 1n : -1n),
            0n,
          )
          .toString(),
      },
      balanceSheet: {
        rows: bsRows,
        assetsMinor: assets.toString(),
        liabilitiesAndEquityMinor: liabilitiesEquity.toString(),
        currentEarningsMinor: currentEarnings.toString(),
      },
      cashFlow: {
        rows: cashFlow.rows.map((row) => ({ group: row.activity, amountMinor: row.amount })),
        netCashChangeMinor: cashFlow.rows
          .reduce((sum, row) => sum + BigInt(row.amount), 0n)
          .toString(),
      },
      reconciliation: {
        journalsBalanced: journalCheck.rows[0]?.balanced ?? false,
        trialBalanceDifferenceMinor: balanceCheck.rows[0]?.difference ?? "0",
        balanceSheetDifferenceMinor: balanceDifference.toString(),
      },
    };
  }

  public async journals(
    playerAccountId: string,
    airlineId: string,
    cursor: number,
    limit: number,
  ): Promise<JournalPage> {
    const book = await this.book(playerAccountId, airlineId);
    const journals = await sql<{
      id: string;
      sequence: string;
      occurred_at: Date;
      posted_at: Date;
      description: string;
      command_type: JournalPage["items"][number]["commandType"];
      transaction_currency: CurrencyCode;
    }>`SELECT id, row_number() OVER (ORDER BY occurred_at, id)::text AS sequence,
      occurred_at, posted_at, description, command_type, transaction_currency
      FROM journal_entries WHERE ledger_book_id=${book.id}::uuid AND status='posted'
      ORDER BY occurred_at DESC, id DESC OFFSET ${cursor} LIMIT ${limit + 1}`.execute(
      this.database,
    );
    const page = journals.rows.slice(0, limit);
    const ids = page.map(({ id }) => id);
    const lines = ids.length
      ? await sql<{
          journal_entry_id: string;
          account_code: string;
          account_name: string;
          side: "debit" | "credit";
          transaction_amount_minor: string;
          reporting_amount_minor: string;
          flight_id: string | null;
          route_id: string | null;
          aircraft_id: string | null;
          contract_id: string | null;
          airline_id: string | null;
        }>`SELECT posting.journal_entry_id, account.code AS account_code,
          account.name AS account_name, posting.side, posting.transaction_amount_minor::text,
          posting.reporting_amount_minor::text, posting.flight_id, posting.route_id,
          posting.aircraft_id, posting.contract_id, posting.airline_id
          FROM ledger_postings posting JOIN ledger_accounts account ON account.id=posting.account_id
          WHERE posting.journal_entry_id=ANY(${ids}::uuid[])
          ORDER BY posting.journal_entry_id, posting.line_number`.execute(this.database)
      : { rows: [] };
    return {
      asOf: new Date().toISOString(),
      reportingCurrency: book.reporting_currency,
      items: page.map((journal) => {
        const journalLines = lines.rows.filter(
          ({ journal_entry_id }) => journal_entry_id === journal.id,
        );
        const dimension = journalLines[0];
        const source = dimension?.flight_id
          ? { entityType: "flight", entityId: dimension.flight_id }
          : dimension?.route_id
            ? { entityType: "route", entityId: dimension.route_id }
            : dimension?.aircraft_id
              ? { entityType: "aircraft", entityId: dimension.aircraft_id }
              : dimension?.contract_id
                ? { entityType: "contract", entityId: dimension.contract_id }
                : dimension?.airline_id
                  ? { entityType: "airline", entityId: dimension.airline_id }
                  : null;
        return {
          id: journal.id,
          sequence: journal.sequence,
          occurredAt: journal.occurred_at.toISOString(),
          postedAt: journal.posted_at.toISOString(),
          description: journal.description,
          commandType: journal.command_type,
          transactionCurrency: journal.transaction_currency,
          source,
          lines: journalLines.map((line) => ({
            accountCode: line.account_code,
            accountName: line.account_name,
            side: line.side,
            transactionAmountMinor: line.transaction_amount_minor,
            reportingAmountMinor: line.reporting_amount_minor,
          })),
        };
      }),
      nextCursor: journals.rows.length > limit ? String(cursor + limit) : null,
    };
  }
}

export class KyselyExchangeRateRepository implements ExchangeRateRepository {
  public constructor(private readonly database: Database) {}
  public async importRates(input: ExchangeRateImport): Promise<ImportedExchangeRates> {
    return runInTransaction(this.database, async (transaction) => {
      const source = await sql<{ interface_version: number }>`SELECT interface_version
        FROM exchange_rate_sources WHERE id = ${input.sourceId}`.execute(transaction);
      if (source.rows[0]?.interface_version !== input.interfaceVersion)
        throw new Error("Exchange-rate source interface version is unsupported.");
      const inserted = await sql<{ id: string }>`INSERT INTO exchange_rate_imports
        (source_id, source_version, effective_at, sha256, provenance)
        VALUES (${input.sourceId}, ${input.sourceVersion}, ${input.effectiveAt.toISOString()}::timestamptz,
          ${input.sha256}, ${JSON.stringify(input.provenance)}::jsonb)
        ON CONFLICT (source_id, source_version, sha256) DO NOTHING
        RETURNING id`.execute(transaction);
      const existing = inserted.rows[0]
        ? undefined
        : await sql<{ id: string }>`SELECT id FROM exchange_rate_imports
        WHERE source_id = ${input.sourceId} AND source_version = ${input.sourceVersion}
          AND sha256 = ${input.sha256}`.execute(transaction);
      const importId = inserted.rows[0]?.id ?? existing?.rows[0]?.id;
      if (!importId) throw new Error("Exchange-rate import was not persisted.");
      for (const rate of input.rates) {
        await sql`INSERT INTO exchange_rates
          (import_id, base_currency, quote_currency, rate_numerator, rate_denominator)
          VALUES (${importId}::uuid, ${rate.baseCurrency}, ${rate.quoteCurrency},
            ${rate.numerator.toString()}::bigint, ${rate.denominator.toString()}::bigint)
          ON CONFLICT (import_id, base_currency, quote_currency) DO NOTHING`.execute(transaction);
      }
      return { importId, rateCount: input.rates.length };
    });
  }
  public async findRate(
    sourceId: string,
    baseCurrency: CurrencyCode,
    quoteCurrency: CurrencyCode,
    at: Date,
  ): Promise<(ExactExchangeRate & { importId: string; effectiveAt: Date }) | undefined> {
    const result = await sql<{
      import_id: string;
      effective_at: Date;
      rate_numerator: string;
      rate_denominator: string;
    }>`
      SELECT r.import_id, i.effective_at, r.rate_numerator, r.rate_denominator
      FROM exchange_rates r JOIN exchange_rate_imports i ON i.id = r.import_id
      WHERE i.source_id = ${sourceId} AND r.base_currency = ${baseCurrency}
        AND r.quote_currency = ${quoteCurrency} AND i.effective_at <= ${at.toISOString()}::timestamptz
      ORDER BY i.effective_at DESC, i.id DESC LIMIT 1`.execute(this.database);
    const row = result.rows[0];
    return row
      ? {
          importId: row.import_id,
          effectiveAt: row.effective_at,
          baseCurrency,
          quoteCurrency,
          numerator: BigInt(row.rate_numerator),
          denominator: BigInt(row.rate_denominator),
        }
      : undefined;
  }
}
