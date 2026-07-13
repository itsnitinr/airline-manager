export const currencyCodes = ["CHF", "EUR", "GBP", "JPY", "KWD", "USD"] as const;
export type CurrencyCode = (typeof currencyCodes)[number];

export const currencyMinorUnits: Readonly<Record<CurrencyCode, number>> = {
  CHF: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  KWD: 3,
  USD: 2,
};

export type ExactMoney = Readonly<{ currency: CurrencyCode; minor: bigint }>;
export type ExactExchangeRate = Readonly<{
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  numerator: bigint;
  denominator: bigint;
}>;

/** Round an exact non-negative rational using bankers' (half-even) rounding. */
export function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error("Invalid non-negative rational.");
  const quotient = numerator / denominator;
  const doubledRemainder = (numerator % denominator) * 2n;
  if (doubledRemainder < denominator) return quotient;
  if (doubledRemainder > denominator) return quotient + 1n;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

/** Convert exact ISO minor units with a major-unit rational rate, never floating point. */
export function convertMoney(amount: ExactMoney, rate: ExactExchangeRate): ExactMoney {
  if (amount.currency !== rate.baseCurrency || rate.numerator <= 0n || rate.denominator <= 0n)
    throw new Error("Money and exchange-rate currencies or ratio are invalid.");
  if (amount.minor < 0n) throw new Error("Conversion accepts non-negative line amounts only.");
  const baseScale = 10n ** BigInt(currencyMinorUnits[rate.baseCurrency]);
  const quoteScale = 10n ** BigInt(currencyMinorUnits[rate.quoteCurrency]);
  return {
    currency: rate.quoteCurrency,
    minor: roundHalfEven(amount.minor * rate.numerator * quoteScale, rate.denominator * baseScale),
  };
}

export const ledgerCommandTypes = [
  "cash",
  "equity",
  "loan",
  "lease",
  "fuel",
  "revenue",
  "wages",
  "maintenance",
  "airport_cost",
  "refund",
  "adjustment",
] as const;
export type LedgerCommandType = (typeof ledgerCommandTypes)[number];
export type PostingSide = "debit" | "credit";
export type PostingDimensions = Readonly<{
  airlineId?: string;
  aircraftId?: string;
  routeId?: string;
  flightId?: string;
  stationId?: string;
  contractId?: string;
}>;
export type PostingLine = Readonly<{
  accountCode: string;
  side: PostingSide;
  transactionAmountMinor: bigint;
  reportingAmountMinor: bigint;
  dimensions?: PostingDimensions;
  memo?: string;
}>;
export type PostJournalCommand = Readonly<{
  ledgerBookId: string;
  idempotencyKey: string;
  commandType: LedgerCommandType;
  entryKind?: "standard" | "adjustment";
  cashFlowActivity?: "operating" | "investing" | "financing";
  description: string;
  occurredAt: Date;
  accountingPeriodId: string;
  transactionCurrency: CurrencyCode;
  reportingCurrency: CurrencyCode;
  exchangeRateImportId?: string;
  exchangeRateNumerator?: bigint;
  exchangeRateDenominator?: bigint;
  postings: readonly PostingLine[];
}>;
export type PostedJournal = Readonly<{ journalEntryId: string; status: "posted"; postedAt: Date }>;
export type CreateLedgerBookCommand = Readonly<{
  ownerType: string;
  ownerId: string;
  reportingCurrency: CurrencyCode;
  templateCode: "airline-career";
  templateVersion: number;
  firstPeriod: Readonly<{ key: string; startsOn: string; endsOn: string }>;
}>;
export type LedgerBook = Readonly<{
  id: string;
  ownerType: string;
  ownerId: string;
  reportingCurrency: CurrencyCode;
  templateVersion: number;
  firstAccountingPeriodId: string;
}>;
export type ExchangeRateImport = Readonly<{
  sourceId: string;
  interfaceVersion: number;
  sourceVersion: string;
  effectiveAt: Date;
  sha256: string;
  provenance: Readonly<Record<string, string>>;
  rates: readonly ExactExchangeRate[];
}>;
export type ImportedExchangeRates = Readonly<{ importId: string; rateCount: number }>;
export type LedgerReportRow = Readonly<{
  category: string;
  accountCode?: string;
  accountName?: string;
  transactionCurrency: CurrencyCode;
  transactionAmountMinor: bigint;
  reportingAmountMinor: bigint;
}>;
export type LedgerReports = Readonly<{
  cash: readonly LedgerReportRow[];
  profitAndLoss: readonly LedgerReportRow[];
  balanceSheet: readonly LedgerReportRow[];
  cashFlow: readonly LedgerReportRow[];
}>;

export interface LedgerRepository {
  createBook(command: CreateLedgerBookCommand): Promise<LedgerBook>;
  post(command: PostJournalCommand): Promise<PostedJournal>;
  reverse(
    ledgerBookId: string,
    journalEntryId: string,
    accountingPeriodId: string,
    occurredAt: Date,
    idempotencyKey: string,
    description: string,
  ): Promise<PostedJournal>;
  closePeriod(accountingPeriodId: string, lock?: boolean): Promise<void>;
  reports(ledgerBookId: string): Promise<LedgerReports>;
}
export interface ExchangeRateRepository {
  importRates(input: ExchangeRateImport): Promise<ImportedExchangeRates>;
  findRate(
    sourceId: string,
    baseCurrency: CurrencyCode,
    quoteCurrency: CurrencyCode,
    at: Date,
  ): Promise<(ExactExchangeRate & { importId: string; effectiveAt: Date }) | undefined>;
}

export type FinancialObligation = Readonly<{
  id: string;
  kind: "founder_loan" | "operating_lease";
  dueAt: string;
  amountMinor: string;
  currency: CurrencyCode;
  status: "scheduled" | "overdue";
  sourceId: string;
}>;

export type RouteProfitability = Readonly<{
  routeId: string;
  originIataCode: string;
  destinationIataCode: string;
  realizedRevenueMinor: string;
  realizedCostMinor: string;
  operatingResultMinor: string;
  settledFlights: number;
}>;

export type FinanceOverview = Readonly<{
  asOf: string;
  reportingCurrency: CurrencyCode;
  supportedTransactionCurrencies: readonly CurrencyCode[];
  cashMinor: string;
  upcomingObligationsMinor: string;
  runwayDays: number | null;
  runwayHorizonDays: number;
  runwayExplanation: string;
  obligations: readonly FinancialObligation[];
  routeProfitability: readonly RouteProfitability[];
  fuel: Readonly<{
    onHandKg: string;
    inventoryValueMinor: string;
    weightedUnitCostNumerator: string;
    weightedUnitCostDenominator: string;
  }>;
  recentResults: readonly Readonly<{
    flightId: string;
    flightNumber: string;
    routeId: string;
    settledAt: string;
    revenueMinor: string;
    costMinor: string;
    operatingResultMinor: string;
  }>[];
}>;

export type FinancialStatementRow = Readonly<{
  accountCode?: string;
  accountName?: string;
  group: string;
  amountMinor: string;
}>;

export type FinanceStatements = Readonly<{
  period: Readonly<{ from: string; to: string }>;
  asOf: string;
  reportingCurrency: CurrencyCode;
  basis: "posted_double_entry_ledger";
  profitAndLoss: Readonly<{ rows: readonly FinancialStatementRow[]; netIncomeMinor: string }>;
  balanceSheet: Readonly<{
    rows: readonly FinancialStatementRow[];
    assetsMinor: string;
    liabilitiesAndEquityMinor: string;
    currentEarningsMinor: string;
  }>;
  cashFlow: Readonly<{
    rows: readonly FinancialStatementRow[];
    netCashChangeMinor: string;
  }>;
  reconciliation: Readonly<{
    journalsBalanced: boolean;
    trialBalanceDifferenceMinor: string;
    balanceSheetDifferenceMinor: string;
  }>;
}>;

export type JournalPage = Readonly<{
  asOf: string;
  reportingCurrency: CurrencyCode;
  items: readonly Readonly<{
    id: string;
    sequence: string;
    occurredAt: string;
    postedAt: string;
    description: string;
    commandType: LedgerCommandType;
    transactionCurrency: CurrencyCode;
    source: Readonly<{ entityType: string; entityId: string }> | null;
    lines: readonly Readonly<{
      accountCode: string;
      accountName: string;
      side: PostingSide;
      transactionAmountMinor: string;
      reportingAmountMinor: string;
    }>[];
  }>[];
  nextCursor: string | null;
}>;

export interface FinanceReadRepository {
  overview(playerAccountId: string, airlineId: string, asOf: Date): Promise<FinanceOverview>;
  statements(
    playerAccountId: string,
    airlineId: string,
    from: Date,
    to: Date,
  ): Promise<FinanceStatements>;
  journals(
    playerAccountId: string,
    airlineId: string,
    cursor: number,
    limit: number,
  ): Promise<JournalPage>;
}

export function assertBalancedPostings(postings: readonly PostingLine[]): void {
  if (postings.length < 2) throw new Error("A journal requires at least two posting lines.");
  let transactionDelta = 0n;
  let reportingDelta = 0n;
  for (const posting of postings) {
    if (posting.transactionAmountMinor < 0n || posting.reportingAmountMinor < 0n)
      throw new Error("Posting amounts must be non-negative exact minor units.");
    if (posting.transactionAmountMinor === 0n && posting.reportingAmountMinor === 0n)
      throw new Error("A posting line cannot be zero in both currencies.");
    const sign = posting.side === "debit" ? 1n : -1n;
    transactionDelta += sign * posting.transactionAmountMinor;
    reportingDelta += sign * posting.reportingAmountMinor;
  }
  if (transactionDelta !== 0n || reportingDelta !== 0n)
    throw new Error("Journal must balance independently in transaction and reporting currency.");
}

export function assertReportingSnapshots(command: PostJournalCommand): void {
  if (command.transactionCurrency === command.reportingCurrency) {
    if (command.postings.some((line) => line.transactionAmountMinor !== line.reportingAmountMinor))
      throw new Error("Same-currency journals must preserve identical minor-unit amounts.");
    return;
  }
  if (
    !command.exchangeRateImportId ||
    !command.exchangeRateNumerator ||
    !command.exchangeRateDenominator
  )
    throw new Error("Foreign-currency journals require a complete exchange-rate snapshot.");
  const rate: ExactExchangeRate = {
    baseCurrency: command.transactionCurrency,
    quoteCurrency: command.reportingCurrency,
    numerator: command.exchangeRateNumerator,
    denominator: command.exchangeRateDenominator,
  };
  for (const line of command.postings) {
    if (line.accountCode === "1900" && line.transactionAmountMinor === 0n) continue;
    const converted = convertMoney(
      { currency: command.transactionCurrency, minor: line.transactionAmountMinor },
      rate,
    );
    if (converted.minor !== line.reportingAmountMinor)
      throw new Error("Reporting amount does not match the exact applied exchange-rate snapshot.");
  }
}
