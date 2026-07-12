import type {
  IdentityRepository,
  WeatherForecastSnapshot,
  WeatherRealizedSnapshot,
  WeatherRepository,
} from "@airline-manager/domain";
import { requireOwnedResource, requireVerifiedPlayer } from "./authorization.js";
import type { Clock, QueryContext } from "./index.js";

export class WeatherService {
  public constructor(
    private readonly weather: WeatherRepository,
    private readonly identity: Pick<IdentityRepository, "ownsResource">,
    private readonly clock: Clock = { now: () => new Date() },
  ) {}

  private async authorize(airlineId: string, context: QueryContext): Promise<string> {
    requireVerifiedPlayer(context.authorization);
    await requireOwnedResource(this.identity, context.authorization, "airline", airlineId);
    return context.authorization.playerAccountId;
  }

  public async routeForecast(
    airlineId: string,
    routeId: string,
    validAt: Date,
    context: QueryContext,
  ): Promise<WeatherForecastSnapshot> {
    const playerId = await this.authorize(airlineId, context);
    return this.weather.forecastRoute(playerId, airlineId, routeId, this.clock.now(), validAt);
  }

  public async departureForecast(
    airlineId: string,
    datedFlightId: string,
    context: QueryContext,
  ): Promise<WeatherForecastSnapshot> {
    const playerId = await this.authorize(airlineId, context);
    return this.weather.forecastDeparture(playerId, airlineId, datedFlightId, this.clock.now());
  }

  /** Internal ticket-17 boundary; no flight lifecycle or settlement is performed here. */
  public async realizeForecast(
    forecastSnapshotId: string,
    realizedAt: Date,
  ): Promise<WeatherRealizedSnapshot> {
    return this.weather.realizeForecast(forecastSnapshotId, realizedAt);
  }
}
