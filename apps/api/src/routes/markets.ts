import { randomUUID } from "node:crypto";
import type { AuthorizationContext, MarketService } from "@airline-manager/application";
import {
  airlineIdentifierParamsSchema,
  bookingCheckpointResponseSchema,
  bookingRefreshRequestSchema,
  commercialFlightOfferRequestSchema,
  commercialFlightOfferResponseSchema,
  commercialOfferAnalyticsResponseSchema,
  commercialOfferIdentifierParamsSchema,
  errorEnvelopeSchema,
  idempotencyHeadersSchema,
  marketIdentifierParamsSchema,
  marketResearchQuerySchema,
  marketResearchResponseSchema,
  pricingStrategiesResponseSchema,
  pricingStrategyRequestSchema,
  pricingStrategyResponseSchema,
  type BookingRefreshRequest,
  type CommercialFlightOfferRequest,
  type PricingStrategyRequest,
} from "@airline-manager/contracts";
import type { FastifyInstance } from "fastify";

type AirlineParams = { airlineId: string };
type MarketParams = AirlineParams & { marketId: string };
type OfferParams = AirlineParams & { offerId: string };
type CommandHeaders = { "idempotency-key": string };

function commandContext(request: {
  id: string;
  headers: CommandHeaders;
  authorizationContext: AuthorizationContext;
}) {
  return {
    requestId: request.id,
    commandId: randomUUID(),
    transactionId: randomUUID(),
    idempotencyKey: request.headers["idempotency-key"],
    authorization: request.authorizationContext,
  };
}

export function registerMarketRoutes(app: FastifyInstance, service?: MarketService): void {
  const required = () => {
    if (!service) throw new Error("Market service is unavailable.");
    return service;
  };
  const errors = {
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
    500: errorEnvelopeSchema,
  } as const;

  app.get<{
    Params: AirlineParams;
    Querystring: { origin: string; destination: string; at?: string };
  }>(
    "/v1/airlines/:airlineId/markets/research",
    {
      schema: {
        operationId: "researchDirectPassengerMarket",
        tags: ["markets"],
        params: airlineIdentifierParamsSchema,
        querystring: marketResearchQuerySchema,
        response: { 200: marketResearchResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().research(
        request.params.airlineId,
        request.query.origin,
        request.query.destination,
        request.query.at ? new Date(request.query.at) : undefined,
        { requestId: request.id, authorization: request.authorizationContext },
      ),
  );

  app.get<{
    Params: AirlineParams;
    Querystring: { origin: string; destination: string; at?: string };
  }>(
    "/v1/airlines/:airlineId/markets/forecast",
    {
      schema: {
        operationId: "forecastDirectPassengerDemand",
        tags: ["markets"],
        params: airlineIdentifierParamsSchema,
        querystring: marketResearchQuerySchema,
        response: { 200: marketResearchResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().research(
        request.params.airlineId,
        request.query.origin,
        request.query.destination,
        request.query.at ? new Date(request.query.at) : undefined,
        { requestId: request.id, authorization: request.authorizationContext },
      ),
  );

  app.post<{ Params: AirlineParams; Body: PricingStrategyRequest; Headers: CommandHeaders }>(
    "/v1/airlines/:airlineId/markets/pricing-strategies",
    {
      schema: {
        operationId: "createPassengerPricingStrategy",
        tags: ["markets"],
        params: airlineIdentifierParamsSchema,
        headers: idempotencyHeadersSchema,
        body: pricingStrategyRequestSchema,
        response: { 201: pricingStrategyResponseSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await required().createPricingStrategy(
            request.params.airlineId,
            request.body,
            commandContext(request),
          ),
        ),
  );

  app.get<{ Params: MarketParams }>(
    "/v1/airlines/:airlineId/markets/:marketId/pricing-strategies",
    {
      schema: {
        operationId: "listPassengerPricingStrategies",
        tags: ["markets"],
        params: marketIdentifierParamsSchema,
        response: { 200: pricingStrategiesResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().pricingStrategies(request.params.airlineId, request.params.marketId, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );

  app.post<{
    Params: AirlineParams;
    Body: CommercialFlightOfferRequest;
    Headers: CommandHeaders;
  }>(
    "/v1/airlines/:airlineId/commercial-flight-offers",
    {
      schema: {
        operationId: "createCommercialFlightOffer",
        tags: ["markets"],
        params: airlineIdentifierParamsSchema,
        headers: idempotencyHeadersSchema,
        body: commercialFlightOfferRequestSchema,
        response: { 201: commercialFlightOfferResponseSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await required().createCommercialOffer(
            request.params.airlineId,
            request.body,
            commandContext(request),
          ),
        ),
  );

  app.post<{ Params: OfferParams; Body: BookingRefreshRequest; Headers: CommandHeaders }>(
    "/v1/airlines/:airlineId/commercial-flight-offers/:offerId/bookings/refresh",
    {
      schema: {
        operationId: "refreshCommercialFlightBookings",
        tags: ["markets"],
        params: commercialOfferIdentifierParamsSchema,
        headers: idempotencyHeadersSchema,
        body: bookingRefreshRequestSchema,
        response: { 200: bookingCheckpointResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().refreshBookings(
        request.params.airlineId,
        request.params.offerId,
        new Date(request.body.checkpointAt),
        commandContext(request),
      ),
  );

  app.get<{ Params: OfferParams; Querystring: { at?: string } }>(
    "/v1/airlines/:airlineId/commercial-flight-offers/:offerId/bookings",
    {
      schema: {
        operationId: "getCommercialFlightBookingAnalytics",
        tags: ["markets"],
        params: commercialOfferIdentifierParamsSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { at: { type: "string", format: "date-time" } },
        },
        response: { 200: commercialOfferAnalyticsResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().offerAnalytics(
        request.params.airlineId,
        request.params.offerId,
        request.query.at ? new Date(request.query.at) : undefined,
        { requestId: request.id, authorization: request.authorizationContext },
      ),
  );
}
