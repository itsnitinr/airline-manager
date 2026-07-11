import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrencyCode, ExchangeRateImport, PostJournalCommand } from "@airline-manager/domain";
import { readDatabasePoolOptions } from "../config.js";
import { createDatabaseRuntime, type DatabaseRuntime } from "../database.js";
import { KyselyExchangeRateRepository, KyselyLedgerRepository } from "./repository.js";

let runtime!: DatabaseRuntime;
let ledger: KyselyLedgerRepository;
let exchange: KyselyExchangeRateRepository;

beforeAll(() => {
  runtime = createDatabaseRuntime(readDatabasePoolOptions("test"));
  ledger = new KyselyLedgerRepository(runtime.database);
  exchange = new KyselyExchangeRateRepository(runtime.database);
});
afterAll(async () => runtime.destroy());

async function createBook(reportingCurrency: CurrencyCode = "USD") {
  return ledger.createBook({
    ownerType: "integration-probe",
    ownerId: randomUUID(),
    reportingCurrency,
    templateCode: "airline-career",
    templateVersion: 1,
    firstPeriod: { key: `period-${randomUUID()}`, startsOn: "2026-01-01", endsOn: "2026-12-31" },
  });
}

function balancedCommand(
  book: Awaited<ReturnType<typeof createBook>>,
  overrides: Partial<PostJournalCommand> = {},
): PostJournalCommand {
  return {
    ledgerBookId: book.id,
    accountingPeriodId: book.firstAccountingPeriodId,
    idempotencyKey: randomUUID(),
    commandType: "equity",
    description: "Integration balanced posting",
    occurredAt: new Date("2026-07-11T12:00:00Z"),
    transactionCurrency: "USD",
    reportingCurrency: "USD",
    postings: [
      {
        accountCode: "1000",
        side: "debit",
        transactionAmountMinor: 10_000n,
        reportingAmountMinor: 10_000n,
      },
      {
        accountCode: "3000",
        side: "credit",
        transactionAmountMinor: 10_000n,
        reportingAmountMinor: 10_000n,
      },
    ],
    ...overrides,
  };
}

describe("PostgreSQL ledger invariants", () => {
  it("selects explicit published chart versions and freezes published definitions", async () => {
    await expect(
      ledger.createBook({
        ownerType: "integration-probe",
        ownerId: randomUUID(),
        reportingCurrency: "USD",
        templateCode: "airline-career",
        templateVersion: 99,
        firstPeriod: { key: "2026", startsOn: "2026-01-01", endsOn: "2026-12-31" },
      }),
    ).rejects.toThrow("template version not found");
    await expect(
      sql`UPDATE chart_of_accounts_template_versions SET description = 'tampered'
      WHERE status = 'published'`.execute(runtime.database),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`DELETE FROM chart_of_accounts_template_accounts
      WHERE template_version_id IN (SELECT id FROM chart_of_accounts_template_versions WHERE status = 'published')`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("prevents an unbalanced draft from reaching posted state in PostgreSQL", async () => {
    const book = await createBook();
    await expect(
      sql`INSERT INTO journal_entries
      (ledger_book_id, accounting_period_id, command_type, status, transaction_currency,
       reporting_currency, description, occurred_at, posted_at)
      VALUES (${book.id}::uuid, ${book.firstAccountingPeriodId}::uuid, 'cash', 'posted',
       'USD', 'USD', 'direct posted insert', '2026-07-11T12:00:00Z', CURRENT_TIMESTAMP)`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const journalId = randomUUID();
    await sql`INSERT INTO journal_entries
      (id, ledger_book_id, accounting_period_id, command_type, transaction_currency,
       reporting_currency, description, occurred_at)
      VALUES (${journalId}::uuid, ${book.id}::uuid, ${book.firstAccountingPeriodId}::uuid,
       'cash', 'USD', 'USD', 'deliberately unbalanced', '2026-07-11T12:00:00Z')`.execute(
      runtime.database,
    );
    await sql`INSERT INTO ledger_postings
      (journal_entry_id, account_id, line_number, side, transaction_amount_minor, reporting_amount_minor)
      SELECT ${journalId}::uuid, id, 1, 'debit', 100, 100 FROM ledger_accounts
      WHERE ledger_book_id = ${book.id}::uuid AND code = '1000'`.execute(runtime.database);
    await sql`INSERT INTO ledger_postings
      (journal_entry_id, account_id, line_number, side, transaction_amount_minor, reporting_amount_minor)
      SELECT ${journalId}::uuid, id, 2, 'credit', 99, 100 FROM ledger_accounts
      WHERE ledger_book_id = ${book.id}::uuid AND code = '3000'`.execute(runtime.database);
    await expect(
      sql`SELECT finalize_journal(${journalId}::uuid)`.execute(runtime.database),
    ).rejects.toMatchObject({ code: "23514" });
    const state = await sql<{
      status: string;
    }>`SELECT status FROM journal_entries WHERE id = ${journalId}::uuid`.execute(runtime.database);
    expect(state.rows[0]?.status).toBe("draft");

    const reportingJournalId = randomUUID();
    await sql`INSERT INTO journal_entries
      (id, ledger_book_id, accounting_period_id, command_type, transaction_currency,
       reporting_currency, description, occurred_at)
      VALUES (${reportingJournalId}::uuid, ${book.id}::uuid, ${book.firstAccountingPeriodId}::uuid,
       'cash', 'USD', 'USD', 'reporting imbalance', '2026-07-11T12:00:00Z')`.execute(
      runtime.database,
    );
    await sql`INSERT INTO ledger_postings
      (journal_entry_id, account_id, line_number, side, transaction_amount_minor, reporting_amount_minor)
      SELECT ${reportingJournalId}::uuid, id, 1, 'debit', 100, 100 FROM ledger_accounts
      WHERE ledger_book_id = ${book.id}::uuid AND code = '1000'`.execute(runtime.database);
    await sql`INSERT INTO ledger_postings
      (journal_entry_id, account_id, line_number, side, transaction_amount_minor, reporting_amount_minor)
      SELECT ${reportingJournalId}::uuid, id, 2, 'credit', 100, 99 FROM ledger_accounts
      WHERE ledger_book_id = ${book.id}::uuid AND code = '3000'`.execute(runtime.database);
    await expect(
      sql`SELECT finalize_journal(${reportingJournalId}::uuid)`.execute(runtime.database),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("finalizes atomically and makes posted journals, postings, accounts, and rates immutable", async () => {
    const book = await createBook();
    const posted = await ledger.post(balancedCommand(book));
    await expect(
      sql`UPDATE journal_entries SET description = 'tampered' WHERE id = ${posted.journalEntryId}::uuid`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`DELETE FROM journal_entries WHERE id = ${posted.journalEntryId}::uuid`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`UPDATE ledger_postings SET transaction_amount_minor = 1 WHERE journal_entry_id = ${posted.journalEntryId}::uuid`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`DELETE FROM ledger_postings WHERE journal_entry_id = ${posted.journalEntryId}::uuid`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      sql`UPDATE ledger_accounts SET name = 'tampered' WHERE ledger_book_id = ${book.id}::uuid`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("is concurrency-safe and returns the original result for one idempotency key", async () => {
    const book = await createBook();
    const command = balancedCommand(book, { idempotencyKey: `same-${randomUUID()}` });
    const results = await Promise.all(Array.from({ length: 8 }, () => ledger.post(command)));
    expect(new Set(results.map(({ journalEntryId }) => journalEntryId)).size).toBe(1);
    const count = await sql<{ count: string }>`SELECT count(*)::text AS count FROM journal_entries
      WHERE ledger_book_id = ${book.id}::uuid AND status = 'posted'`.execute(runtime.database);
    expect(count.rows[0]?.count).toBe("1");
    await expect(ledger.post({ ...command, description: "different payload" })).rejects.toThrow(
      "different request",
    );
  });

  it("enforces explicit non-overlapping periods and refuses posting after close", async () => {
    const book = await createBook();
    await expect(
      sql`INSERT INTO accounting_periods (ledger_book_id, period_key, starts_on, ends_on)
      VALUES (${book.id}::uuid, 'overlap', '2026-06-01', '2026-08-01')`.execute(runtime.database),
    ).rejects.toMatchObject({ code: "23514" });
    await ledger.closePeriod(book.firstAccountingPeriodId);
    await expect(ledger.post(balancedCommand(book))).rejects.toMatchObject({ code: "23514" });
    await expect(
      sql`UPDATE accounting_periods SET status = 'open', closed_at = NULL
      WHERE id = ${book.firstAccountingPeriodId}::uuid`.execute(runtime.database),
    ).rejects.toMatchObject({ code: "55000" });
  });
});

describe("exchange snapshots, corrections, dimensions, and reports", () => {
  it("imports deterministic versioned offline rates idempotently with provenance", async () => {
    const fixture = JSON.parse(
      await readFile(new URL("../../data/exchange-rates-v1.json", import.meta.url), "utf8"),
    ) as {
      interface_version: number;
      source_id: string;
      source_version: string;
      effective_at: string;
      sha256: string;
      provenance: Record<string, string>;
      rates: Array<{
        base_currency: CurrencyCode;
        quote_currency: CurrencyCode;
        numerator: string;
        denominator: string;
      }>;
    };
    const input: ExchangeRateImport = {
      sourceId: fixture.source_id,
      interfaceVersion: fixture.interface_version,
      sourceVersion: fixture.source_version,
      effectiveAt: new Date(fixture.effective_at),
      sha256: fixture.sha256,
      provenance: fixture.provenance,
      rates: fixture.rates.map((rate) => ({
        baseCurrency: rate.base_currency,
        quoteCurrency: rate.quote_currency,
        numerator: BigInt(rate.numerator),
        denominator: BigInt(rate.denominator),
      })),
    };
    const first = await exchange.importRates(input);
    const repeated = await exchange.importRates(input);
    expect(repeated.importId).toBe(first.importId);
    expect(
      await exchange.findRate("offline-fixture", "EUR", "USD", new Date("2026-07-12")),
    ).toMatchObject({ importId: first.importId, numerator: 109n, denominator: 100n });
    await expect(
      sql`UPDATE exchange_rates SET rate_numerator = 1 WHERE import_id = ${first.importId}::uuid`.execute(
        runtime.database,
      ),
    ).rejects.toMatchObject({ code: "55000" });
  });

  it("stores every optional attribution dimension and exact applied rate snapshot", async () => {
    const book = await createBook();
    const rate = await exchange.findRate("offline-fixture", "EUR", "USD", new Date("2026-07-12"));
    if (!rate) throw new Error("Offline rate fixture must be imported by the preceding test.");
    const dimensions = {
      airlineId: randomUUID(),
      aircraftId: randomUUID(),
      routeId: randomUUID(),
      flightId: randomUUID(),
      stationId: randomUUID(),
      contractId: randomUUID(),
    };
    const posted = await ledger.post(
      balancedCommand(book, {
        commandType: "revenue",
        transactionCurrency: "EUR",
        reportingCurrency: "USD",
        exchangeRateImportId: rate.importId,
        exchangeRateNumerator: rate.numerator,
        exchangeRateDenominator: rate.denominator,
        postings: [
          {
            accountCode: "1000",
            side: "debit",
            transactionAmountMinor: 10_000n,
            reportingAmountMinor: 10_900n,
            dimensions,
          },
          {
            accountCode: "4000",
            side: "credit",
            transactionAmountMinor: 10_000n,
            reportingAmountMinor: 10_900n,
            dimensions,
          },
        ],
      }),
    );
    const stored = await sql<Record<keyof typeof dimensions, string> & { rate_numerator: string }>`
      SELECT p.airline_id AS "airlineId", p.aircraft_id AS "aircraftId", p.route_id AS "routeId",
        p.flight_id AS "flightId", p.station_id AS "stationId", p.contract_id AS "contractId",
        j.exchange_rate_numerator AS rate_numerator
      FROM ledger_postings p JOIN journal_entries j ON j.id = p.journal_entry_id
      WHERE j.id = ${posted.journalEntryId}::uuid LIMIT 1`.execute(runtime.database);
    expect(stored.rows[0]).toMatchObject({ ...dimensions, rate_numerator: "109" });
  });

  it("uses linked reversals and separate adjusting journals while retaining history", async () => {
    const book = await createBook();
    const original = await ledger.post(balancedCommand(book));
    const reversal = await ledger.reverse(
      book.id,
      original.journalEntryId,
      book.firstAccountingPeriodId,
      new Date("2026-07-12T00:00:00Z"),
      randomUUID(),
      "Correct erroneous equity entry",
    );
    const adjustment = await ledger.post(
      balancedCommand(book, {
        commandType: "adjustment",
        entryKind: "adjustment",
        idempotencyKey: randomUUID(),
        description: "Explicit period adjustment",
      }),
    );
    const rows = await sql<{
      id: string;
      entry_kind: string;
      reversal_of_journal_entry_id: string | null;
    }>`
      SELECT id, entry_kind, reversal_of_journal_entry_id FROM journal_entries
      WHERE id IN (${original.journalEntryId}::uuid, ${reversal.journalEntryId}::uuid, ${adjustment.journalEntryId}::uuid)
      ORDER BY created_at`.execute(runtime.database);
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: original.journalEntryId, entry_kind: "standard" }),
        expect.objectContaining({
          id: reversal.journalEntryId,
          entry_kind: "reversal",
          reversal_of_journal_entry_id: original.journalEntryId,
        }),
        expect.objectContaining({ id: adjustment.journalEntryId, entry_kind: "adjustment" }),
      ]),
    );
    expect(rows.rows).toHaveLength(3);
  });

  it("derives reconciling cash, P&L, balance sheet, cash flow, and account balances", async () => {
    const book = await createBook();
    await ledger.post(balancedCommand(book));
    await ledger.post(
      balancedCommand(book, {
        commandType: "revenue",
        idempotencyKey: randomUUID(),
        postings: [
          {
            accountCode: "1000",
            side: "debit",
            transactionAmountMinor: 5_000n,
            reportingAmountMinor: 5_000n,
          },
          {
            accountCode: "4000",
            side: "credit",
            transactionAmountMinor: 5_000n,
            reportingAmountMinor: 5_000n,
          },
        ],
      }),
    );
    const reports = await ledger.reports(book.id);
    expect(reports.cash).toEqual([
      expect.objectContaining({ transactionAmountMinor: 15_000n, reportingAmountMinor: 15_000n }),
    ]);
    expect(reports.profitAndLoss).toEqual([
      expect.objectContaining({ accountCode: "4000", reportingAmountMinor: 5_000n }),
    ]);
    expect(reports.balanceSheet).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "1000", reportingAmountMinor: 15_000n }),
        expect.objectContaining({ accountCode: "3000", reportingAmountMinor: 10_000n }),
      ]),
    );
    expect(reports.cashFlow).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "financing", reportingAmountMinor: 10_000n }),
        expect.objectContaining({ category: "operating", reportingAmountMinor: 5_000n }),
      ]),
    );
    const reconciliation = await sql<{ debits: string; credits: string; cash_balance: string }>`
      SELECT sum(p.reporting_amount_minor) FILTER (WHERE p.side = 'debit')::text AS debits,
        sum(p.reporting_amount_minor) FILTER (WHERE p.side = 'credit')::text AS credits,
        (SELECT sum(reporting_balance_minor)::text FROM ledger_account_balances
          WHERE ledger_book_id = ${book.id}::uuid AND code = '1000') AS cash_balance
      FROM ledger_postings p JOIN journal_entries j ON j.id = p.journal_entry_id
      WHERE j.ledger_book_id = ${book.id}::uuid AND j.status = 'posted'`.execute(runtime.database);
    expect(reconciliation.rows[0]).toEqual({
      debits: "15000",
      credits: "15000",
      cash_balance: "15000",
    });
  });
});
