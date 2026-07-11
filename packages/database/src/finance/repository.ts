import { createHash, randomUUID } from "node:crypto";
import { sql, type Transaction } from "kysely";
import type {
  CreateLedgerBookCommand,
  CurrencyCode,
  ExchangeRateImport,
  ExchangeRateRepository,
  ExactExchangeRate,
  ImportedExchangeRates,
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
  public constructor(private readonly database: Database) {}

  public async createBook(command: CreateLedgerBookCommand): Promise<LedgerBook> {
    return runInTransaction(
      this.database,
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
    return runInTransaction(
      this.database,
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
    await runInTransaction(
      this.database,
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
