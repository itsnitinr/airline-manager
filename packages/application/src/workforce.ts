import type {
  HireWorkforceInput,
  IdentityRepository,
  WorkforceForecast,
  WorkforceHire,
  WorkforcePool,
  WorkforceReadiness,
  WorkforceRepository,
  WorkforceStarterPackage,
  WorkforceWageAccrual,
} from "@airline-manager/domain";
import { requireOwnedResource, requireVerifiedPlayer } from "./authorization.js";
import type { Clock, CommandContext, QueryContext } from "./index.js";

export class WorkforceService {
  public constructor(
    private readonly workforce: WorkforceRepository,
    private readonly identity: Pick<IdentityRepository, "ownsResource">,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  private async authorize(airlineId: string, context: QueryContext | CommandContext) {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    return context.authorization.playerAccountId;
  }

  public async recommendations(
    airlineId: string,
    context: QueryContext,
  ): Promise<readonly WorkforceStarterPackage[]> {
    return this.workforce.recommendations(await this.authorize(airlineId, context), airlineId);
  }

  public async listPools(
    airlineId: string,
    context: QueryContext,
  ): Promise<readonly WorkforcePool[]> {
    return this.workforce.listPools(
      await this.authorize(airlineId, context),
      airlineId,
      this.clock.now(),
    );
  }

  public async hire(
    airlineId: string,
    input: HireWorkforceInput,
    context: CommandContext,
  ): Promise<WorkforceHire> {
    return this.workforce.hire(
      await this.authorize(airlineId, context),
      airlineId,
      input,
      context.idempotencyKey,
      this.clock.now(),
    );
  }

  public async forecast(
    airlineId: string,
    through: Date,
    context: QueryContext,
  ): Promise<WorkforceForecast> {
    return this.workforce.forecast(
      await this.authorize(airlineId, context),
      airlineId,
      through,
      this.clock.now(),
    );
  }

  /** Stable transactional readiness boundary for ticket 17; it does not mutate flight lifecycle state. */
  public async allocateFlight(
    airlineId: string,
    flightId: string,
    context: CommandContext,
  ): Promise<WorkforceReadiness> {
    return this.workforce.allocateFlight(
      await this.authorize(airlineId, context),
      airlineId,
      flightId,
      this.clock.now(),
    );
  }

  public async accrueWages(
    airlineId: string,
    through: Date,
    context: CommandContext,
  ): Promise<readonly WorkforceWageAccrual[]> {
    return this.workforce.accrueWages(
      await this.authorize(airlineId, context),
      airlineId,
      through,
      context.idempotencyKey,
      this.clock.now(),
    );
  }
}
