import type {
  ActivateTimetableInput,
  IdentityRepository,
  MarketRepository,
  Route,
  RouteResearch,
  SchedulingRepository,
  TimetableActivation,
} from "@airline-manager/domain";
import { SchedulingDomainError, forecastRoute, validateRoute } from "@airline-manager/domain";
import { requireOwnedResource, requireVerifiedPlayer } from "./authorization.js";
import type { Clock, CommandContext, QueryContext } from "./index.js";

export class SchedulingService {
  public constructor(
    private readonly scheduling: SchedulingRepository,
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
    aircraftId: string,
    at: Date | undefined,
    context: QueryContext,
  ): Promise<RouteResearch> {
    const playerId = await this.authorize(airlineId, context);
    const now = at ?? this.clock.now();
    const [market, origin, destination, plane, home] = await Promise.all([
      this.markets.research(playerId, airlineId, originIataCode, destinationIataCode, now),
      this.scheduling.airportFacts(airlineId, originIataCode, playerId),
      this.scheduling.airportFacts(airlineId, destinationIataCode, playerId),
      this.scheduling.aircraftFacts(airlineId, aircraftId, playerId),
      this.scheduling.airlineHomeJurisdiction(airlineId, playerId),
    ]);
    const forecast = forecastRoute(origin, destination, plane, market);
    const issues = validateRoute(origin, destination, plane, home, forecast);
    return {
      market,
      forecast,
      valid: issues.length === 0,
      issues,
      explanations: [
        "Distance uses a deterministic great-circle model; block time adds category cruise time and fixed taxi allowance.",
        "Operating cost and demand are provisional forecasts bound to scheduling-v1 and ticket 11 market rules.",
        "Both endpoints use eligible outsourced service; no station investment is required in slice one.",
      ],
    };
  }

  public async createRoute(
    airlineId: string,
    originIataCode: string,
    destinationIataCode: string,
    aircraftId: string,
    context: CommandContext,
  ): Promise<Route> {
    const playerId = await this.authorize(airlineId, context);
    const now = this.clock.now();
    const market = await this.markets.research(
      playerId,
      airlineId,
      originIataCode,
      destinationIataCode,
      now,
    );
    const [origin, destination, plane, home] = await Promise.all([
      this.scheduling.airportFacts(airlineId, originIataCode, playerId),
      this.scheduling.airportFacts(airlineId, destinationIataCode, playerId),
      this.scheduling.aircraftFacts(airlineId, aircraftId, playerId),
      this.scheduling.airlineHomeJurisdiction(airlineId, playerId),
    ]);
    const forecast = forecastRoute(origin, destination, plane, market);
    const issues = validateRoute(origin, destination, plane, home, forecast);
    if (issues.length)
      throw new SchedulingDomainError(
        "invalid_route",
        "The researched route is not operable with the selected aircraft.",
        issues,
      );
    return this.scheduling.createRoute(
      playerId,
      airlineId,
      market.marketId,
      originIataCode,
      destinationIataCode,
      forecast,
      now,
    );
  }

  public async listRoutes(airlineId: string, context: QueryContext): Promise<readonly Route[]> {
    const playerId = await this.authorize(airlineId, context);
    return this.scheduling.listRoutes(playerId, airlineId);
  }

  public async activateTimetable(
    airlineId: string,
    routeId: string,
    input: ActivateTimetableInput,
    context: CommandContext,
  ): Promise<TimetableActivation> {
    const playerId = await this.authorize(airlineId, context);
    const now = this.clock.now();
    const activation = await this.scheduling.activateTimetable(
      playerId,
      airlineId,
      routeId,
      input,
      now,
    );
    for (const flight of activation.flights)
      await this.markets.createCommercialOffer(playerId, flight.commercialOffer, now);
    return activation;
  }

  public async extendHorizon(
    airlineId: string,
    timetableVersionId: string,
    through: Date,
    context: CommandContext,
  ): Promise<TimetableActivation> {
    const playerId = await this.authorize(airlineId, context);
    const now = this.clock.now();
    const activation = await this.scheduling.extendHorizon(
      playerId,
      airlineId,
      timetableVersionId,
      through,
      now,
    );
    for (const flight of activation.flights)
      await this.markets.createCommercialOffer(playerId, flight.commercialOffer, now);
    return activation;
  }
}
