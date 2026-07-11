import { describe, expect, it, vi } from "vitest";
import type { LedgerRepository, PostJournalCommand, PostedJournal } from "@airline-manager/domain";
import { FinancePostingService } from "./finance.js";

describe("finance posting application boundary", () => {
  it("exposes every ticket-07 posting family without framework types", async () => {
    const posted: PostedJournal = {
      journalEntryId: "journal",
      status: "posted",
      postedAt: new Date(0),
    };
    const post = vi.fn<LedgerRepository["post"]>().mockResolvedValue(posted);
    const repository = { post } as unknown as LedgerRepository;
    const service = new FinancePostingService(repository);
    const command: Omit<PostJournalCommand, "commandType"> = {
      ledgerBookId: "book",
      accountingPeriodId: "period",
      idempotencyKey: "key",
      description: "test",
      occurredAt: new Date(0),
      transactionCurrency: "USD",
      reportingCurrency: "USD",
      postings: [
        {
          accountCode: "1000",
          side: "debit",
          transactionAmountMinor: 1n,
          reportingAmountMinor: 1n,
        },
        {
          accountCode: "3000",
          side: "credit",
          transactionAmountMinor: 1n,
          reportingAmountMinor: 1n,
        },
      ],
    };
    await service.applyCash(command);
    await service.applyEquity(command);
    await service.applyLoan(command);
    await service.applyLease(command);
    await service.applyFuel(command);
    await service.applyRevenue(command);
    await service.applyWages(command);
    await service.applyMaintenance(command);
    await service.applyAirportCost(command);
    await service.applyRefund(command);
    await service.applyAdjustment(command);
    expect(post.mock.calls.map(([input]) => input.commandType)).toEqual([
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
    ]);
  });
});
