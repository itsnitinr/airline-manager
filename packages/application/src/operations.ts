import type {
  FlightMilestone,
  FlightOperationsRepository,
  FlightStatus,
  IdentityRepository,
  SettledFlightSnapshot,
} from "@airline-manager/domain";
import { requireOwnedResource, requireVerifiedPlayer } from "./authorization.js";
import type { QueryContext } from "./index.js";
import type { HandlerOutcome, JobEnvelopeV1 } from "./runtime.js";

export class FlightOperationsService {
  public constructor(
    private readonly operations: FlightOperationsRepository,
    private readonly identity: Pick<IdentityRepository, "ownsResource">,
  ) {}

  public async status(
    airlineId: string,
    flightId: string,
    context: QueryContext,
  ): Promise<FlightStatus> {
    requireVerifiedPlayer(context.authorization);
    const playerId = context.authorization.playerAccountId;
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    return this.operations.status(playerId, airlineId, flightId);
  }

  public async settlement(
    airlineId: string,
    flightId: string,
    context: QueryContext,
  ): Promise<SettledFlightSnapshot> {
    requireVerifiedPlayer(context.authorization);
    const playerId = context.authorization.playerAccountId;
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    return this.operations.settlement(playerId, airlineId, flightId);
  }
}

export class FlightMilestoneHandler {
  public constructor(
    private readonly operations: FlightOperationsRepository,
    private readonly milestone: FlightMilestone,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async handle(envelope: JobEnvelopeV1): Promise<HandlerOutcome> {
    if (envelope.entityType !== "dated_flight") return { kind: "noop" };
    return {
      kind: await this.operations.advanceMilestone(
        envelope.entityId,
        this.milestone,
        BigInt(envelope.expectedVersion),
        envelope.commandId,
        new Date(envelope.targetTime),
        this.now(),
      ),
    };
  }
}
