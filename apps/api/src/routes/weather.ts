import type { AuthorizationContext, WeatherService } from "@airline-manager/application";
import {
  errorEnvelopeSchema,
  weatherDepartureParamsSchema,
  weatherForecastQuerySchema,
  weatherForecastResponseSchema,
  weatherRouteParamsSchema,
} from "@airline-manager/contracts";
import type { FastifyInstance } from "fastify";

type RouteParams = { airlineId: string; routeId: string };
type DepartureParams = { airlineId: string; datedFlightId: string };

function queryContext(request: { id: string; authorizationContext: AuthorizationContext }) {
  return { requestId: request.id, authorization: request.authorizationContext };
}

export function registerWeatherRoutes(app: FastifyInstance, service?: WeatherService): void {
  const required = () => {
    if (!service) throw new Error("Weather service is unavailable.");
    return service;
  };
  const errors = {
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
    500: errorEnvelopeSchema,
  } as const;

  app.get<{ Params: RouteParams; Querystring: { validAt: string } }>(
    "/v1/airlines/:airlineId/routes/:routeId/weather-forecast",
    {
      schema: {
        operationId: "getRouteWeatherForecast",
        tags: ["weather"],
        params: weatherRouteParamsSchema,
        querystring: weatherForecastQuerySchema,
        response: { 200: weatherForecastResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().routeForecast(
        request.params.airlineId,
        request.params.routeId,
        new Date(request.query.validAt),
        queryContext(request),
      ),
  );

  app.get<{ Params: DepartureParams }>(
    "/v1/airlines/:airlineId/departures/:datedFlightId/weather-forecast",
    {
      schema: {
        operationId: "getDepartureWeatherForecast",
        tags: ["weather"],
        params: weatherDepartureParamsSchema,
        response: { 200: weatherForecastResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().departureForecast(
        request.params.airlineId,
        request.params.datedFlightId,
        queryContext(request),
      ),
  );
}
