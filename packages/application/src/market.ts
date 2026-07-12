import type {
  BookingCheckpoint,
  CommercialFlightOffer,
  CommercialFlightOfferInput,
  CommercialOfferAnalytics,
  CreatePricingStrategyInput,
  IdentityRepository,
  MarketRepository,
  MarketResearch,
  PricingStrategy,
} from "@airline-manager/domain";
import { requireOwnedResource, requireVerifiedPlayer } from "./authorization.js";
import type { Clock, CommandContext, QueryContext } from "./index.js";

export class MarketService {
  public constructor(
    private readonly markets: MarketRepository,
    private readonly identity: Pick<IdentityRepository, "ownsResource">,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  private async authorize(airlineId: string, context: QueryContext | CommandContext) {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    return context.authorization.playerAccountId;
  }

  public async research(
    airlineId: string,
    originIataCode: string,
    destinationIataCode: string,
    at: Date | undefined,
    context: QueryContext,
  ): Promise<MarketResearch> {
    const playerId = await this.authorize(airlineId, context);
    return this.markets.research(
      playerId,
      airlineId,
      originIataCode,
      destinationIataCode,
      at ?? this.clock.now(),
    );
  }

  public async createPricingStrategy(
    airlineId: string,
    input: CreatePricingStrategyInput,
    context: CommandContext,
  ): Promise<PricingStrategy> {
    const playerId = await this.authorize(airlineId, context);
    return this.markets.createPricingStrategy(playerId, airlineId, input, this.clock.now());
  }

  public async pricingStrategies(
    airlineId: string,
    marketId: string,
    context: QueryContext,
  ): Promise<readonly PricingStrategy[]> {
    const playerId = await this.authorize(airlineId, context);
    return this.markets.pricingStrategies(playerId, airlineId, marketId);
  }

  /** Stable ticket-12 boundary: caller supplies one opaque dated-flight offer id and immutable source reference. */
  public async createCommercialOffer(
    airlineId: string,
    input: Omit<CommercialFlightOfferInput, "airlineId">,
    context: CommandContext,
  ): Promise<CommercialFlightOffer> {
    const playerId = await this.authorize(airlineId, context);
    return this.markets.createCommercialOffer(playerId, { ...input, airlineId }, this.clock.now());
  }

  public async refreshBookings(
    airlineId: string,
    offerId: string,
    checkpointAt: Date | undefined,
    context: CommandContext,
  ): Promise<BookingCheckpoint> {
    const playerId = await this.authorize(airlineId, context);
    return this.markets.refreshBookings(
      playerId,
      airlineId,
      offerId,
      checkpointAt ?? this.clock.now(),
      context.idempotencyKey,
    );
  }

  public async offerAnalytics(
    airlineId: string,
    offerId: string,
    at: Date | undefined,
    context: QueryContext,
  ): Promise<CommercialOfferAnalytics> {
    const playerId = await this.authorize(airlineId, context);
    return this.markets.offerAnalytics(playerId, airlineId, offerId, at ?? this.clock.now());
  }
}
