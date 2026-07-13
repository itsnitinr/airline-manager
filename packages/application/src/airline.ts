import type {
  AirlineFoundingRepository,
  AirlineSummary,
  FoundingConfirmation,
  FoundingPreview,
  FoundingSelection,
  IdentityRepository,
} from "@airline-manager/domain";
import { requireOwnedResource, requireVerifiedPlayer } from "./authorization.js";
import type { Clock, CommandContext, QueryContext } from "./index.js";

export class AirlineFoundingService {
  public constructor(
    private readonly founding: AirlineFoundingRepository,
    private readonly identity: Pick<IdentityRepository, "ownsResource">,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  public preview(selection: FoundingSelection, context: QueryContext): Promise<FoundingPreview> {
    requireVerifiedPlayer(context.authorization);
    return this.founding.preview(
      context.authorization.playerAccountId,
      selection,
      this.clock.now(),
    );
  }

  public confirm(
    selection: FoundingSelection,
    context: CommandContext,
  ): Promise<FoundingConfirmation> {
    requireVerifiedPlayer(context.authorization);
    return this.founding.confirm(
      context.authorization.playerAccountId,
      selection,
      context.idempotencyKey,
      this.clock.now(),
    );
  }

  public async summary(airlineId: string, context: QueryContext): Promise<AirlineSummary> {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    return this.founding.summary(context.authorization.playerAccountId, airlineId);
  }

  public currentSummary(context: QueryContext): Promise<AirlineSummary | null> {
    requireVerifiedPlayer(context.authorization);
    return this.founding.currentSummary(context.authorization.playerAccountId);
  }
}
