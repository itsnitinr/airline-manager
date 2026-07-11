import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  assertBalancedPostings,
  assertReportingSnapshots,
  convertMoney,
  currencyCodes,
  currencyMinorUnits,
  roundHalfEven,
  type PostingLine,
} from "./finance.js";

describe("exact money and ledger properties", () => {
  it("accepts arbitrary constructed zero-sum postings and rejects a one-unit imbalance", () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 1n, max: 9_000_000_000n }), { minLength: 1, maxLength: 20 }),
        fc.array(fc.bigInt({ min: 1n, max: 9_000_000_000n }), { minLength: 1, maxLength: 20 }),
        (debits, credits) => {
          const debitTotal = debits.reduce((sum, amount) => sum + amount, 0n);
          const creditTotal = credits.reduce((sum, amount) => sum + amount, 0n);
          const lines: PostingLine[] = [
            ...debits.map((amount) => ({
              accountCode: "1000",
              side: "debit" as const,
              transactionAmountMinor: amount,
              reportingAmountMinor: amount,
            })),
            ...credits.map((amount) => ({
              accountCode: "2000",
              side: "credit" as const,
              transactionAmountMinor: amount,
              reportingAmountMinor: amount,
            })),
            ...(debitTotal > creditTotal
              ? [
                  {
                    accountCode: "2000",
                    side: "credit" as const,
                    transactionAmountMinor: debitTotal - creditTotal,
                    reportingAmountMinor: debitTotal - creditTotal,
                  },
                ]
              : creditTotal > debitTotal
                ? [
                    {
                      accountCode: "1000",
                      side: "debit" as const,
                      transactionAmountMinor: creditTotal - debitTotal,
                      reportingAmountMinor: creditTotal - debitTotal,
                    },
                  ]
                : []),
          ];
          assertBalancedPostings(lines);
          const first = lines[0];
          if (!first) return;
          expect(() =>
            assertBalancedPostings([
              { ...first, transactionAmountMinor: first.transactionAmountMinor + 1n },
              ...lines.slice(1),
            ]),
          ).toThrow("balance independently");
        },
      ),
    );
  });

  it("uses declared ISO minor units across arbitrary supported currencies", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...currencyCodes),
        fc.nat({ max: 1_000_000 }),
        (currency, major) => {
          const minor = BigInt(major) * 10n ** BigInt(currencyMinorUnits[currency]);
          expect(minor % 10n ** BigInt(currencyMinorUnits[currency])).toBe(0n);
        },
      ),
    );
    expect(currencyMinorUnits).toMatchObject({ JPY: 0, USD: 2, KWD: 3 });
  });

  it("rounds exact half boundaries to even", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 1_000_000n }), (whole) => {
        expect(roundHalfEven(whole * 2n + 1n, 2n)).toBe(whole % 2n === 0n ? whole : whole + 1n);
      }),
    );
    expect(roundHalfEven(1n, 2n)).toBe(0n);
    expect(roundHalfEven(3n, 2n)).toBe(2n);
    expect(roundHalfEven(5n, 2n)).toBe(2n);
  });

  it("converts arbitrary exact rational exchange rates without floating point", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10_000_000_000n }),
        fc.bigInt({ min: 1n, max: 10_000n }),
        fc.bigInt({ min: 1n, max: 10_000n }),
        (minor, numerator, denominator) => {
          const converted = convertMoney(
            { currency: "JPY", minor },
            {
              baseCurrency: "JPY",
              quoteCurrency: "KWD",
              numerator,
              denominator,
            },
          );
          expect(converted.minor).toBe(roundHalfEven(minor * numerator * 1000n, denominator));
        },
      ),
    );
  });

  it("requires line snapshots to match conversion and permits only explicit FX rounding lines", () => {
    const command = {
      ledgerBookId: "book",
      accountingPeriodId: "period",
      idempotencyKey: "key",
      commandType: "adjustment" as const,
      description: "rounding boundary",
      occurredAt: new Date(0),
      transactionCurrency: "EUR" as const,
      reportingCurrency: "USD" as const,
      exchangeRateImportId: "import",
      exchangeRateNumerator: 3n,
      exchangeRateDenominator: 2n,
      postings: [
        {
          accountCode: "1000",
          side: "debit" as const,
          transactionAmountMinor: 2n,
          reportingAmountMinor: 3n,
        },
        {
          accountCode: "4000",
          side: "credit" as const,
          transactionAmountMinor: 1n,
          reportingAmountMinor: 2n,
        },
        {
          accountCode: "4000",
          side: "credit" as const,
          transactionAmountMinor: 1n,
          reportingAmountMinor: 2n,
        },
        {
          accountCode: "1900",
          side: "debit" as const,
          transactionAmountMinor: 0n,
          reportingAmountMinor: 1n,
        },
      ],
    };
    assertBalancedPostings(command.postings);
    assertReportingSnapshots(command);
    expect(() =>
      assertReportingSnapshots({
        ...command,
        postings: command.postings.map((line, index) =>
          index === 0 ? { ...line, reportingAmountMinor: 4n } : line,
        ),
      }),
    ).toThrow("exact applied exchange-rate");
  });
});
