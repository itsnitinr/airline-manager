import type {
  LedgerCommandType,
  LedgerRepository,
  PostJournalCommand,
  PostedJournal,
} from "@airline-manager/domain";

type TypedPostingCommand = Omit<PostJournalCommand, "commandType">;

/** Framework-independent application boundary used by API routes and workers. */
export class FinancePostingService {
  public constructor(private readonly ledger: LedgerRepository) {}

  private post(
    commandType: LedgerCommandType,
    command: TypedPostingCommand,
  ): Promise<PostedJournal> {
    return this.ledger.post({ ...command, commandType });
  }

  public applyCash(command: TypedPostingCommand) {
    return this.post("cash", command);
  }
  public applyEquity(command: TypedPostingCommand) {
    return this.post("equity", command);
  }
  public applyLoan(command: TypedPostingCommand) {
    return this.post("loan", command);
  }
  public applyLease(command: TypedPostingCommand) {
    return this.post("lease", command);
  }
  public applyFuel(command: TypedPostingCommand) {
    return this.post("fuel", command);
  }
  public applyRevenue(command: TypedPostingCommand) {
    return this.post("revenue", command);
  }
  public applyWages(command: TypedPostingCommand) {
    return this.post("wages", command);
  }
  public applyMaintenance(command: TypedPostingCommand) {
    return this.post("maintenance", command);
  }
  public applyAirportCost(command: TypedPostingCommand) {
    return this.post("airport_cost", command);
  }
  public applyRefund(command: TypedPostingCommand) {
    return this.post("refund", command);
  }
  public applyAdjustment(command: TypedPostingCommand) {
    return this.post("adjustment", command);
  }

  public reverse(
    ledgerBookId: string,
    journalEntryId: string,
    accountingPeriodId: string,
    occurredAt: Date,
    idempotencyKey: string,
    description: string,
  ): Promise<PostedJournal> {
    return this.ledger.reverse(
      ledgerBookId,
      journalEntryId,
      accountingPeriodId,
      occurredAt,
      idempotencyKey,
      description,
    );
  }
}
