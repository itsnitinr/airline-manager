import type {
  FinanceOverview,
  FinanceReadRepository,
  FinanceStatements,
  IdentityRepository,
  JournalPage,
  LedgerCommandType,
  LedgerRepository,
  PostJournalCommand,
  PostedJournal,
} from "@airline-manager/domain";
import { requireOwnedResource, requireVerifiedPlayer } from "./authorization.js";
import type { QueryContext } from "./index.js";

export class FinanceQueryService {
  public constructor(
    private readonly reports: FinanceReadRepository,
    private readonly identity: Pick<IdentityRepository, "ownsResource">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async player(airlineId: string, context: QueryContext): Promise<string> {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    return context.authorization.playerAccountId;
  }

  public async overview(airlineId: string, context: QueryContext): Promise<FinanceOverview> {
    return this.reports.overview(await this.player(airlineId, context), airlineId, this.now());
  }

  public async statements(
    airlineId: string,
    from: Date,
    to: Date,
    context: QueryContext,
  ): Promise<FinanceStatements> {
    const player = await this.player(airlineId, context);
    if (to <= from || to.getTime() - from.getTime() > 366 * 86_400_000) {
      throw new Error("Financial reporting period must be positive and no longer than 366 days.");
    }
    return this.reports.statements(player, airlineId, from, to);
  }

  public async journals(
    airlineId: string,
    cursor: number,
    limit: number,
    context: QueryContext,
  ): Promise<JournalPage> {
    return this.reports.journals(
      await this.player(airlineId, context),
      airlineId,
      Math.max(0, cursor),
      Math.min(100, Math.max(1, limit)),
    );
  }
}

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
