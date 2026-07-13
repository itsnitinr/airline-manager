import type {
  FlightMilestone,
  FlightBoard,
  FlightBoardQuery,
  FlightOperationsRepository,
  FlightStatus,
  IdentityRepository,
  OfflineFlightChanges,
  SettledFlightSnapshot,
} from "@airline-manager/domain";
import { FlightLifecycleError } from "@airline-manager/domain";
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

  public async board(
    airlineId: string,
    query: FlightBoardQuery,
    context: QueryContext,
  ): Promise<FlightBoard> {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    const maximumTo = new Date(query.from.getTime() + 31 * 86_400_000);
    if (query.to <= query.from || query.to > maximumTo) {
      throw new FlightLifecycleError(
        "settlement_invariant_failed",
        "Operations horizon must be positive and no longer than 31 days.",
      );
    }
    return this.operations.board(context.authorization.playerAccountId, airlineId, {
      ...query,
      limit: Math.min(200, Math.max(1, query.limit)),
    });
  }

  public async changes(
    airlineId: string,
    since: Date,
    limit: number,
    context: QueryContext,
  ): Promise<OfflineFlightChanges> {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    const now = new Date();
    if (since > now || since < new Date(now.getTime() - 31 * 86_400_000)) {
      throw new FlightLifecycleError(
        "settlement_invariant_failed",
        "Offline change history is bounded to the prior 31 days.",
      );
    }
    return this.operations.changes(
      context.authorization.playerAccountId,
      airlineId,
      since,
      Math.min(100, Math.max(1, limit)),
    );
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
