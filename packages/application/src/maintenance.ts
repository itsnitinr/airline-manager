import type {
  FlightCompletionUtilizationInput,
  FlightCompletionUtilizationResult,
  IdentityRepository,
  MaintenanceForecast,
  MaintenanceHistoryEvent,
  MaintenanceProgram,
  MaintenanceRepository,
  MaintenanceWindowInput,
  MaintenanceWorkPackage,
} from "@airline-manager/domain";
import { requireOwnedResource, requireVerifiedPlayer } from "./authorization.js";
import type { Clock, CommandContext, QueryContext } from "./index.js";

export class MaintenanceService {
  public constructor(
    private readonly maintenance: MaintenanceRepository,
    private readonly identity: Pick<IdentityRepository, "ownsResource">,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  private async authorize(airlineId: string, context: QueryContext | CommandContext) {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    return context.authorization.playerAccountId;
  }

  public async program(
    airlineId: string,
    aircraftId: string,
    context: QueryContext,
  ): Promise<MaintenanceProgram> {
    return this.maintenance.program(
      await this.authorize(airlineId, context),
      airlineId,
      aircraftId,
      this.clock.now(),
    );
  }

  /** Stable idempotent utilization input port for ticket 17 flight completion. */
  public async recordFlightCompletion(
    airlineId: string,
    input: FlightCompletionUtilizationInput,
    context: CommandContext,
  ): Promise<FlightCompletionUtilizationResult> {
    return this.maintenance.recordFlightCompletion(
      await this.authorize(airlineId, context),
      airlineId,
      input,
      this.clock.now(),
    );
  }

  public async scheduleWork(
    airlineId: string,
    aircraftId: string,
    input: MaintenanceWindowInput,
    context: CommandContext,
  ): Promise<MaintenanceWorkPackage> {
    return this.maintenance.scheduleWork(
      await this.authorize(airlineId, context),
      airlineId,
      aircraftId,
      input,
      context.idempotencyKey,
      this.clock.now(),
    );
  }

  public async completeWork(
    airlineId: string,
    workPackageId: string,
    context: CommandContext,
  ): Promise<MaintenanceWorkPackage> {
    return this.maintenance.completeWork(
      await this.authorize(airlineId, context),
      airlineId,
      workPackageId,
      context.idempotencyKey,
      this.clock.now(),
    );
  }

  public async forecast(
    airlineId: string,
    aircraftId: string,
    context: QueryContext,
  ): Promise<MaintenanceForecast> {
    return this.maintenance.forecast(
      await this.authorize(airlineId, context),
      airlineId,
      aircraftId,
      this.clock.now(),
    );
  }

  /** Stable dispatch-readiness port for ticket 17; it does not mutate flight lifecycle state. */
  public async dispatchReadiness(
    airlineId: string,
    aircraftId: string,
    at: Date,
    context: QueryContext,
  ): Promise<MaintenanceForecast> {
    return this.maintenance.dispatchReadiness(
      await this.authorize(airlineId, context),
      airlineId,
      aircraftId,
      at,
    );
  }

  public async history(
    airlineId: string,
    aircraftId: string,
    context: QueryContext,
  ): Promise<readonly MaintenanceHistoryEvent[]> {
    return this.maintenance.history(
      await this.authorize(airlineId, context),
      airlineId,
      aircraftId,
    );
  }
}
