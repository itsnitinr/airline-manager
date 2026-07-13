import {
  type FleetRepository,
  type FounderLeaseAcceptance,
  type FounderLeasePreview,
  type FounderPackageComparison,
  type FleetAircraft,
  type FleetAircraftPlanningDetail,
  type IdentityRepository,
} from "@airline-manager/domain";
import { requireOwnedResource, requireVerifiedPlayer } from "./authorization.js";
import type { Clock, CommandContext, QueryContext } from "./index.js";

export class FleetService {
  public constructor(
    private readonly fleet: FleetRepository,
    private readonly identity: Pick<IdentityRepository, "ownsResource">,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  public async listFounderPackage(
    airlineId: string,
    context: QueryContext,
  ): Promise<FounderPackageComparison> {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    return this.fleet.listFounderPackage(context.authorization.playerAccountId, airlineId);
  }

  public async previewFounderLease(
    airlineId: string,
    optionCode: string,
    context: QueryContext,
  ): Promise<FounderLeasePreview> {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    return this.fleet.previewFounderLease(
      context.authorization.playerAccountId,
      airlineId,
      optionCode,
      this.clock.now(),
    );
  }

  public async acceptFounderLease(
    airlineId: string,
    optionCode: string,
    context: CommandContext,
  ): Promise<FounderLeaseAcceptance> {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    return this.fleet.acceptFounderLease(
      context.authorization.playerAccountId,
      airlineId,
      optionCode,
      context.idempotencyKey,
      this.clock.now(),
    );
  }

  public async listFleet(
    airlineId: string,
    context: QueryContext,
  ): Promise<readonly FleetAircraft[]> {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    return this.fleet.listFleet(context.authorization.playerAccountId, airlineId, this.clock.now());
  }

  public async getAircraft(
    airlineId: string,
    aircraftId: string,
    context: QueryContext,
  ): Promise<FleetAircraft> {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    await requireOwnedResource(this.identity, context.authorization, "aircraft", aircraftId);
    const aircraft = await this.fleet.getAircraft(
      context.authorization.playerAccountId,
      aircraftId,
      this.clock.now(),
    );
    if (aircraft.airlineId !== airlineId) {
      await requireOwnedResource(
        this.identity,
        context.authorization,
        "airline",
        "00000000-0000-0000-0000-000000000000",
      );
    }
    return aircraft;
  }

  public async getAircraftPlanningDetail(
    airlineId: string,
    aircraftId: string,
    context: QueryContext,
  ): Promise<FleetAircraftPlanningDetail> {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    await requireOwnedResource(this.identity, context.authorization, "aircraft", aircraftId);
    const detail = await this.fleet.getAircraftPlanningDetail(
      context.authorization.playerAccountId,
      aircraftId,
      this.clock.now(),
    );
    if (detail.aircraft.airlineId !== airlineId) {
      await requireOwnedResource(
        this.identity,
        context.authorization,
        "airline",
        "00000000-0000-0000-0000-000000000000",
      );
    }
    return detail;
  }
}

/** Framework-independent, injected-clock boundary for ticket 16 delivery jobs. */
export class DueAircraftDeliveryHandler {
  public constructor(
    private readonly fleet: Pick<FleetRepository, "completeDueDelivery">,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  public execute(aircraftId: string, expectedVersion: bigint): Promise<FleetAircraft> {
    return this.fleet.completeDueDelivery(aircraftId, expectedVersion, this.clock.now());
  }
}
