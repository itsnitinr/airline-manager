import { currencyCodes, roundHalfEven, type CurrencyCode } from "./finance.js";

export const careerStatuses = ["active", "insolvent", "closed"] as const;
export type CareerStatus = (typeof careerStatuses)[number];

export type AirlineBrand = Readonly<{
  primaryColor: string;
  secondaryColor: string;
  logoMark: string;
}>;

export type FoundingSelection = Readonly<{
  airlineName: string;
  fictionalIdentityConfirmed: boolean;
  homeJurisdiction: string;
  principalBaseIataCode: string;
  reportingCurrency: CurrencyCode;
  brand: AirlineBrand;
  acceptFoundingLoan: boolean;
  worldRulesetVersion: string;
}>;

export type FoundingBalance = Readonly<{
  id: string;
  version: string;
  worldRulesetId: string;
  founderEquityMinor: bigint;
  loanPrincipalMinor: bigint;
  loanAnnualRateBasisPoints: number;
  loanTermDays: number;
  loanInstallmentCount: number;
  baselineDailyObligationMinor: bigint;
  forecastHorizonDays: number;
  assumptions: Readonly<{
    included: readonly string[];
    excludedUntilTicket09: readonly string[];
    method: string;
  }>;
}>;

export type FoundingLoanInstallment = Readonly<{
  installmentNumber: number;
  dueAt: Date;
  principalMinor: bigint;
  interestMinor: bigint;
  totalMinor: bigint;
}>;

export type CashRunwayForecast = Readonly<{
  currency: CurrencyCode;
  openingCashMinor: string;
  founderEquityMinor: string;
  foundingLoanProceedsMinor: string;
  baselineDailyObligationMinor: string;
  scheduledLoanRepaymentsMinor: string;
  runwayDays: number | null;
  forecastHorizonDays: number;
  assumptions: FoundingBalance["assumptions"];
  explanation: string;
}>;

export type FoundingPreview = Readonly<{
  normalizedAirlineName: string;
  catalogReleaseVersion: string;
  worldRulesetVersion: string;
  foundingBalanceVersion: string;
  principalBase: Readonly<{
    airportId: string;
    iataCode: string;
    name: string;
    countryCode: string;
    stationServiceModel: "outsourced";
  }>;
  financing: Readonly<{
    founderEquityMinor: string;
    optionalLoan: Readonly<{
      principalMinor: string;
      annualRateBasisPoints: number;
      termDays: number;
      installmentCount: number;
      selected: boolean;
      schedule: readonly Readonly<{
        installmentNumber: number;
        dueAt: string;
        principalMinor: string;
        interestMinor: string;
        totalMinor: string;
      }>[];
    }>;
  }>;
  runway: CashRunwayForecast;
  nextStep: "select_founder_aircraft";
  nextStepGuidance: string;
}>;

export type FoundingConfirmation = FoundingPreview &
  Readonly<{
    careerId: string;
    airlineId: string;
    stationId: string;
    ledgerBookId: string;
    careerStatus: "active";
    foundedAt: string;
  }>;

export type AirlineSummary = Readonly<{
  careerId: string;
  airlineId: string;
  name: string;
  normalizedAirlineName: string;
  brand: AirlineBrand;
  careerStatus: CareerStatus;
  airlineStatus: CareerStatus;
  homeJurisdiction: string;
  reportingCurrency: CurrencyCode;
  catalogReleaseVersion: string;
  worldRulesetVersion: string;
  foundingBalanceVersion: string;
  principalBase: FoundingPreview["principalBase"];
  cashMinor: string;
  equityMinor: string;
  loanLiabilityMinor: string;
  nextStep: "select_founder_aircraft";
  nextStepGuidance: string;
}>;

export class FoundingDomainError extends Error {
  public constructor(
    readonly code:
      | "active_airline_exists"
      | "airline_name_unavailable"
      | "fictional_identity_required"
      | "invalid_airline_identity"
      | "invalid_brand"
      | "invalid_home_jurisdiction"
      | "invalid_principal_base"
      | "airport_jurisdiction_mismatch"
      | "invalid_reporting_currency"
      | "inactive_world_ruleset"
      | "founding_not_found"
      | "idempotency_conflict",
    message: string,
  ) {
    super(message);
    this.name = "FoundingDomainError";
  }
}

export function normalizeAirlineName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function validateFoundingSelection(selection: FoundingSelection): string {
  const name = selection.airlineName.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!selection.fictionalIdentityConfirmed) {
    throw new FoundingDomainError(
      "fictional_identity_required",
      "The player must confirm that the airline identity is fictional.",
    );
  }
  if (
    name.length < 3 ||
    name.length > 80 ||
    !/^[\p{L}\p{N}][\p{L}\p{N} .&'’-]*[\p{L}\p{N}]$/u.test(name)
  ) {
    throw new FoundingDomainError(
      "invalid_airline_identity",
      "Airline name must be a plausible fictional identity between 3 and 80 characters.",
    );
  }
  if (!/^[A-Z]{2}$/.test(selection.homeJurisdiction)) {
    throw new FoundingDomainError(
      "invalid_home_jurisdiction",
      "Home jurisdiction must be an uppercase ISO alpha-2 code.",
    );
  }
  if (!/^[A-Z]{3}$/.test(selection.principalBaseIataCode)) {
    throw new FoundingDomainError(
      "invalid_principal_base",
      "Principal base must be identified by an uppercase IATA airport code.",
    );
  }
  if (!currencyCodes.includes(selection.reportingCurrency)) {
    throw new FoundingDomainError(
      "invalid_reporting_currency",
      "Reporting currency is not supported by the exact-money ledger.",
    );
  }
  if (
    !/^#[0-9A-F]{6}$/.test(selection.brand.primaryColor) ||
    !/^#[0-9A-F]{6}$/.test(selection.brand.secondaryColor) ||
    !/^[A-Z0-9]{1,3}$/.test(selection.brand.logoMark) ||
    selection.brand.primaryColor === selection.brand.secondaryColor
  ) {
    throw new FoundingDomainError(
      "invalid_brand",
      "Brand colors must be distinct uppercase hex colors and logo mark must be 1-3 uppercase letters or digits.",
    );
  }
  return normalizeAirlineName(name);
}

export function createFoundingLoanSchedule(
  principalMinor: bigint,
  annualRateBasisPoints: number,
  termDays: number,
  installmentCount: number,
  startsAt: Date,
): readonly FoundingLoanInstallment[] {
  if (
    principalMinor <= 0n ||
    !Number.isSafeInteger(annualRateBasisPoints) ||
    annualRateBasisPoints < 0 ||
    !Number.isSafeInteger(termDays) ||
    !Number.isSafeInteger(installmentCount) ||
    termDays < installmentCount ||
    installmentCount < 1
  ) {
    throw new Error("Founding loan terms are invalid.");
  }
  const count = BigInt(installmentCount);
  const basePrincipal = principalMinor / count;
  const principalRemainder = principalMinor % count;
  let outstanding = principalMinor;
  let priorDueDay = 0;
  const schedule: FoundingLoanInstallment[] = [];
  for (let index = 1; index <= installmentCount; index += 1) {
    const dueDay = Math.floor((termDays * index) / installmentCount);
    const intervalDays = dueDay - priorDueDay;
    const installmentPrincipal = basePrincipal + (BigInt(index) <= principalRemainder ? 1n : 0n);
    const interestMinor = roundHalfEven(
      outstanding * BigInt(annualRateBasisPoints) * BigInt(intervalDays),
      10_000n * 365n,
    );
    const dueAt = new Date(startsAt.getTime() + dueDay * 86_400_000);
    schedule.push({
      installmentNumber: index,
      dueAt,
      principalMinor: installmentPrincipal,
      interestMinor,
      totalMinor: installmentPrincipal + interestMinor,
    });
    outstanding -= installmentPrincipal;
    priorDueDay = dueDay;
  }
  if (outstanding !== 0n) throw new Error("Founding loan principal did not amortize exactly.");
  return schedule;
}

export function forecastFoundingCashRunway(
  currency: CurrencyCode,
  balance: FoundingBalance,
  acceptLoan: boolean,
  startsAt: Date,
): CashRunwayForecast {
  const schedule = acceptLoan
    ? createFoundingLoanSchedule(
        balance.loanPrincipalMinor,
        balance.loanAnnualRateBasisPoints,
        balance.loanTermDays,
        balance.loanInstallmentCount,
        startsAt,
      )
    : [];
  const loanProceeds = acceptLoan ? balance.loanPrincipalMinor : 0n;
  let cash = balance.founderEquityMinor + loanProceeds;
  let runwayDays: number | null = null;
  for (let day = 1; day <= balance.forecastHorizonDays; day += 1) {
    cash -= balance.baselineDailyObligationMinor;
    for (const installment of schedule) {
      const dueDay = Math.round((installment.dueAt.getTime() - startsAt.getTime()) / 86_400_000);
      if (dueDay === day) cash -= installment.totalMinor;
    }
    if (cash < 0n) {
      runwayDays = day - 1;
      break;
    }
  }
  const repayments = schedule.reduce((total, installment) => total + installment.totalMinor, 0n);
  return {
    currency,
    openingCashMinor: (balance.founderEquityMinor + loanProceeds).toString(),
    founderEquityMinor: balance.founderEquityMinor.toString(),
    foundingLoanProceedsMinor: loanProceeds.toString(),
    baselineDailyObligationMinor: balance.baselineDailyObligationMinor.toString(),
    scheduledLoanRepaymentsMinor: repayments.toString(),
    runwayDays,
    forecastHorizonDays: balance.forecastHorizonDays,
    assumptions: balance.assumptions,
    explanation:
      runwayDays === null
        ? `Opening cash covers the ${balance.forecastHorizonDays}-real-day forecast horizon under the listed pre-aircraft assumptions.`
        : `Opening cash covers ${runwayDays} complete real days under the listed pre-aircraft assumptions.`,
  };
}

export interface AirlineFoundingRepository {
  preview(
    playerAccountId: string,
    selection: FoundingSelection,
    now: Date,
  ): Promise<FoundingPreview>;
  confirm(
    playerAccountId: string,
    selection: FoundingSelection,
    idempotencyKey: string,
    now: Date,
  ): Promise<FoundingConfirmation>;
  summary(playerAccountId: string, airlineId: string): Promise<AirlineSummary>;
  currentSummary(playerAccountId: string): Promise<AirlineSummary | null>;
}
