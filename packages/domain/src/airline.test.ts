import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FoundingDomainError,
  createFoundingLoanSchedule,
  forecastFoundingCashRunway,
  normalizeAirlineName,
  validateFoundingSelection,
  type FoundingBalance,
  type FoundingSelection,
} from "./airline.js";

const startsAt = new Date("2026-07-11T12:00:00.000Z");
const selection: FoundingSelection = {
  airlineName: "  North   Star Air  ",
  fictionalIdentityConfirmed: true,
  homeJurisdiction: "US",
  principalBaseIataCode: "JFK",
  reportingCurrency: "USD",
  brand: { primaryColor: "#112233", secondaryColor: "#DDEEFF", logoMark: "NS" },
  acceptFoundingLoan: true,
  worldRulesetVersion: "contemporary-2026.07.11",
};

const balance: FoundingBalance = {
  id: "balance-id",
  version: "founding-v1",
  worldRulesetId: "ruleset-id",
  founderEquityMinor: 55_000_000n,
  loanPrincipalMinor: 11_000_000n,
  loanAnnualRateBasisPoints: 1200,
  loanTermDays: 30,
  loanInstallmentCount: 6,
  baselineDailyObligationMinor: 440_000n,
  forecastHorizonDays: 365,
  assumptions: {
    included: ["corporate administration baseline", "outsourced station baseline"],
    excludedUntilTicket09: ["aircraft lease payments", "aircraft fuel"],
    method: "pre-aircraft baseline plus exact debt schedule",
  },
};

describe("airline founding domain", () => {
  it("normalizes and validates a confirmed fictional identity, brand, and founding choices", () => {
    expect(validateFoundingSelection(selection)).toBe("north star air");
    expect(normalizeAirlineName("Ｎｏｒｔｈ  Star AIR")).toBe("north star air");
  });

  it.each([
    [{ ...selection, fictionalIdentityConfirmed: false }, "fictional_identity_required"],
    [{ ...selection, airlineName: "--" }, "invalid_airline_identity"],
    [{ ...selection, homeJurisdiction: "USA" }, "invalid_home_jurisdiction"],
    [{ ...selection, principalBaseIataCode: "jfk" }, "invalid_principal_base"],
    [
      {
        ...selection,
        brand: { primaryColor: "#112233", secondaryColor: "#112233", logoMark: "NS" },
      },
      "invalid_brand",
    ],
  ] as const)("rejects invalid founding selection %#", (candidate, code) => {
    expect(() => validateFoundingSelection(candidate)).toThrowError(
      expect.objectContaining<Partial<FoundingDomainError>>({ code }),
    );
  });

  it("builds a deterministic compressed-real-day amortization schedule with exact minor units", () => {
    const first = createFoundingLoanSchedule(11_000_000n, 1200, 30, 6, startsAt);
    const second = createFoundingLoanSchedule(11_000_000n, 1200, 30, 6, startsAt);
    expect(first).toEqual(second);
    expect(first).toHaveLength(6);
    expect(first[0]?.dueAt.toISOString()).toBe("2026-07-16T12:00:00.000Z");
    expect(first.at(-1)?.dueAt.toISOString()).toBe("2026-08-10T12:00:00.000Z");
    expect(first.reduce((total, row) => total + row.principalMinor, 0n)).toBe(11_000_000n);
    expect(first.every((row) => row.totalMinor === row.principalMinor + row.interestMinor)).toBe(
      true,
    );
  });

  it("amortizes every valid generated principal exactly", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10_000_000_000n }),
        fc.integer({ min: 1, max: 30 }),
        fc.integer({ min: 0, max: 5000 }),
        (principal, installments, basisPoints) => {
          const rows = createFoundingLoanSchedule(
            principal,
            basisPoints,
            installments * 3,
            installments,
            startsAt,
          );
          expect(rows.reduce((total, row) => total + row.principalMinor, 0n)).toBe(principal);
          expect(rows.map((row) => row.dueAt.getTime())).toEqual(
            [...rows].map((row) => row.dueAt.getTime()).sort((left, right) => left - right),
          );
        },
      ),
    );
  });

  it("explains the pre-aircraft runway without inventing aircraft costs", () => {
    const withLoan = forecastFoundingCashRunway("USD", balance, true, startsAt);
    const withoutLoan = forecastFoundingCashRunway("USD", balance, false, startsAt);
    expect(withLoan.openingCashMinor).toBe("66000000");
    expect(withLoan.scheduledLoanRepaymentsMinor).not.toBe("0");
    expect(withoutLoan.foundingLoanProceedsMinor).toBe("0");
    expect(withoutLoan.scheduledLoanRepaymentsMinor).toBe("0");
    expect(withLoan.assumptions.excludedUntilTicket09).toContain("aircraft lease payments");
    expect(withLoan.assumptions.excludedUntilTicket09).toContain("aircraft fuel");
    expect(withLoan.explanation).toContain("pre-aircraft assumptions");
  });
});
