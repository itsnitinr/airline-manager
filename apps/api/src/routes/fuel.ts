import { randomUUID } from "node:crypto";
import type { AuthorizationContext, FuelService } from "@airline-manager/application";
import {
  airlineIdentifierParamsSchema,
  errorEnvelopeSchema,
  fuelCapacityOffersResponseSchema,
  fuelCapacityUpgradeRequestSchema,
  fuelCapacityUpgradeResponseSchema,
  fuelForecastRequestSchema,
  fuelForecastResponseSchema,
  fuelInventoryResponseSchema,
  fuelLotsResponseSchema,
  fuelMovementsResponseSchema,
  fuelPricesResponseSchema,
  fuelPurchaseResponseSchema,
  fuelQuantityRequestSchema,
  fuelQuotePurchaseRequestSchema,
  fuelQuoteResponseSchema,
  fuelReserveRequestSchema,
  idempotencyHeadersSchema,
  type FuelCapacityUpgradeRequest,
  type FuelForecastRequest,
  type FuelQuantityRequest,
  type FuelQuotePurchaseRequest,
  type FuelReserveRequest,
} from "@airline-manager/contracts";
import type { FastifyInstance } from "fastify";

type AirlineParams = { airlineId: string };
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

export function registerFuelRoutes(app: FastifyInstance, service?: FuelService): void {
  const required = () => {
    if (!service) throw new Error("Fuel service is unavailable.");
    return service;
  };
  const errors = {
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
    500: errorEnvelopeSchema,
  } as const;

  app.get<{ Params: AirlineParams; Querystring: { recentBuckets?: number } }>(
    "/v1/airlines/:airlineId/fuel/prices",
    {
      schema: {
        operationId: "getFuelPrices",
        tags: ["fuel"],
        params: airlineIdentifierParamsSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { recentBuckets: { type: "integer", minimum: 1, maximum: 48, default: 24 } },
        },
        response: { 200: fuelPricesResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().prices(request.params.airlineId, request.query.recentBuckets ?? 24, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );

  app.post<{ Params: AirlineParams; Body: FuelQuantityRequest }>(
    "/v1/airlines/:airlineId/fuel/quotes",
    {
      schema: {
        operationId: "createFuelQuote",
        tags: ["fuel"],
        params: airlineIdentifierParamsSchema,
        body: fuelQuantityRequestSchema,
        response: { 201: fuelQuoteResponseSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply.status(201).send(
        await required().createQuote(request.params.airlineId, BigInt(request.body.quantityKg), {
          requestId: request.id,
          authorization: request.authorizationContext,
        }),
      ),
  );

  app.post<{ Params: AirlineParams; Body: FuelQuotePurchaseRequest; Headers: CommandHeaders }>(
    "/v1/airlines/:airlineId/fuel/purchases",
    {
      schema: {
        operationId: "purchaseFuel",
        tags: ["fuel"],
        params: airlineIdentifierParamsSchema,
        headers: idempotencyHeadersSchema,
        body: fuelQuotePurchaseRequestSchema,
        response: { 201: fuelPurchaseResponseSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await required().purchase(
            request.params.airlineId,
            request.body.quoteId,
            commandContext(request),
          ),
        ),
  );

  app.get<{ Params: AirlineParams }>(
    "/v1/airlines/:airlineId/fuel/inventory",
    {
      schema: {
        operationId: "getFuelInventory",
        tags: ["fuel"],
        params: airlineIdentifierParamsSchema,
        response: { 200: fuelInventoryResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().inventory(request.params.airlineId, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );
  app.get<{ Params: AirlineParams }>(
    "/v1/airlines/:airlineId/fuel/lots",
    {
      schema: {
        operationId: "listFuelLots",
        tags: ["fuel"],
        params: airlineIdentifierParamsSchema,
        response: { 200: fuelLotsResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().lots(request.params.airlineId, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );
  app.get<{ Params: AirlineParams }>(
    "/v1/airlines/:airlineId/fuel/movements",
    {
      schema: {
        operationId: "listFuelMovements",
        tags: ["fuel"],
        params: airlineIdentifierParamsSchema,
        response: { 200: fuelMovementsResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().movements(request.params.airlineId, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );

  app.put<{ Params: AirlineParams; Body: FuelReserveRequest; Headers: CommandHeaders }>(
    "/v1/airlines/:airlineId/fuel/reserve",
    {
      schema: {
        operationId: "setFuelReserve",
        tags: ["fuel"],
        params: airlineIdentifierParamsSchema,
        headers: idempotencyHeadersSchema,
        body: fuelReserveRequestSchema,
        response: { 200: fuelInventoryResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().setReserve(
        request.params.airlineId,
        BigInt(request.body.planningReservedKg),
        commandContext(request),
      ),
  );

  app.post<{ Params: AirlineParams; Body: FuelForecastRequest }>(
    "/v1/airlines/:airlineId/fuel/forecast",
    {
      schema: {
        operationId: "forecastFuel",
        tags: ["fuel"],
        params: airlineIdentifierParamsSchema,
        body: fuelForecastRequestSchema,
        response: { 200: fuelForecastResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().forecast(request.params.airlineId, BigInt(request.body.projectedConsumptionKg), {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );

  app.get<{ Params: AirlineParams }>(
    "/v1/airlines/:airlineId/fuel/capacity-offers",
    {
      schema: {
        operationId: "getFuelCapacityOffers",
        tags: ["fuel"],
        params: airlineIdentifierParamsSchema,
        response: { 200: fuelCapacityOffersResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().capacityOffers(request.params.airlineId, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );

  app.post<{ Params: AirlineParams; Body: FuelCapacityUpgradeRequest; Headers: CommandHeaders }>(
    "/v1/airlines/:airlineId/fuel/capacity-upgrades",
    {
      schema: {
        operationId: "purchaseFuelCapacity",
        tags: ["fuel"],
        params: airlineIdentifierParamsSchema,
        headers: idempotencyHeadersSchema,
        body: fuelCapacityUpgradeRequestSchema,
        response: { 201: fuelCapacityUpgradeResponseSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await required().purchaseCapacity(
            request.params.airlineId,
            request.body.tier,
            commandContext(request),
          ),
        ),
  );
}
