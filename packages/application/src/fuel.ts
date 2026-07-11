import type {
  FuelCapacityOffer,
  FuelCapacityUpgrade,
  FuelForecast,
  FuelInventory,
  FuelLot,
  FuelMovement,
  FuelPrice,
  FuelPurchase,
  FuelQuote,
  FuelRepository,
  IdentityRepository,
} from "@airline-manager/domain";
import { requireOwnedResource, requireVerifiedPlayer } from "./authorization.js";
import type { Clock, CommandContext, QueryContext } from "./index.js";

export class FuelService {
  public constructor(
    private readonly fuel: FuelRepository,
    private readonly identity: Pick<IdentityRepository, "ownsResource">,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  private async authorize(airlineId: string, context: QueryContext | CommandContext) {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    return context.authorization.playerAccountId;
  }

  public async prices(
    airlineId: string,
    recentBuckets: number,
    context: QueryContext,
  ): Promise<readonly FuelPrice[]> {
    const playerId = await this.authorize(airlineId, context);
    return this.fuel.currentPrices(playerId, airlineId, this.clock.now(), recentBuckets);
  }

  public async createQuote(
    airlineId: string,
    quantityKg: bigint,
    context: QueryContext,
  ): Promise<FuelQuote> {
    const playerId = await this.authorize(airlineId, context);
    return this.fuel.createQuote(playerId, airlineId, quantityKg, this.clock.now());
  }

  public async purchase(
    airlineId: string,
    quoteId: string,
    context: CommandContext,
  ): Promise<FuelPurchase> {
    const playerId = await this.authorize(airlineId, context);
    return this.fuel.purchase(
      playerId,
      airlineId,
      quoteId,
      context.idempotencyKey,
      this.clock.now(),
    );
  }

  public async inventory(airlineId: string, context: QueryContext): Promise<FuelInventory> {
    const playerId = await this.authorize(airlineId, context);
    return this.fuel.inventory(playerId, airlineId);
  }

  public async lots(airlineId: string, context: QueryContext): Promise<readonly FuelLot[]> {
    const playerId = await this.authorize(airlineId, context);
    return this.fuel.lots(playerId, airlineId);
  }

  public async movements(
    airlineId: string,
    context: QueryContext,
  ): Promise<readonly FuelMovement[]> {
    const playerId = await this.authorize(airlineId, context);
    return this.fuel.movements(playerId, airlineId);
  }

  public async setReserve(
    airlineId: string,
    reservedKg: bigint,
    context: CommandContext,
  ): Promise<FuelInventory> {
    const playerId = await this.authorize(airlineId, context);
    return this.fuel.setReserve(
      playerId,
      airlineId,
      reservedKg,
      context.idempotencyKey,
      this.clock.now(),
    );
  }

  public async forecast(
    airlineId: string,
    projectedConsumptionKg: bigint,
    context: QueryContext,
  ): Promise<FuelForecast> {
    const playerId = await this.authorize(airlineId, context);
    return this.fuel.forecast(playerId, airlineId, projectedConsumptionKg);
  }

  public async capacityOffers(
    airlineId: string,
    context: QueryContext,
  ): Promise<readonly FuelCapacityOffer[]> {
    const playerId = await this.authorize(airlineId, context);
    return this.fuel.capacityOffers(playerId, airlineId);
  }

  public async purchaseCapacity(
    airlineId: string,
    tier: number,
    context: CommandContext,
  ): Promise<FuelCapacityUpgrade> {
    const playerId = await this.authorize(airlineId, context);
    return this.fuel.purchaseCapacity(
      playerId,
      airlineId,
      tier,
      context.idempotencyKey,
      this.clock.now(),
    );
  }
}

/** Framework-independent, idempotent ticket-17 boundary. Burn is already calculated in exact kilograms. */
export class FuelConsumptionService {
  public constructor(
    private readonly fuel: Pick<FuelRepository, "consume">,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  public consume(
    input: Readonly<{
      airlineId: string;
      burnKg: bigint;
      sourceType: string;
      sourceId: string;
      idempotencyKey: string;
    }>,
  ): Promise<FuelInventory> {
    return this.fuel.consume(
      input.airlineId,
      input.burnKg,
      input.sourceType,
      input.sourceId,
      input.idempotencyKey,
      this.clock.now(),
    );
  }
}
