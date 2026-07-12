import { randomUUID } from "node:crypto";
import type { AuthorizationContext, WorkforceService } from "@airline-manager/application";
import {
  airlineIdentifierParamsSchema,
  errorEnvelopeSchema,
  idempotencyHeadersSchema,
  workforceFlightParamsSchema,
  workforceForecastRequestSchema,
  workforceForecastResponseSchema,
  workforceHireRequestSchema,
  workforceHireResponseSchema,
  workforcePoolsResponseSchema,
  workforceReadinessResponseSchema,
  workforceRecommendationsResponseSchema,
  workforceWageAccrualRequestSchema,
  workforceWageAccrualResponseSchema,
  type WorkforceForecastRequest,
  type WorkforceHireRequest,
  type WorkforceWageAccrualRequest,
} from "@airline-manager/contracts";
import type { FastifyInstance } from "fastify";

type AirlineParams = { airlineId: string };
type FlightParams = AirlineParams & { flightId: string };
type Headers = { "idempotency-key": string };

function commandContext(request: {
  id: string;
  headers: Headers;
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

export function registerWorkforceRoutes(app: FastifyInstance, service?: WorkforceService): void {
  const required = () => {
    if (!service) throw new Error("Workforce service is unavailable.");
    return service;
  };
  const errors = {
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
    500: errorEnvelopeSchema,
  } as const;
  app.get<{ Params: AirlineParams }>(
    "/v1/airlines/:airlineId/workforce/recommendations",
    {
      schema: {
        operationId: "getWorkforceRecommendations",
        tags: ["workforce"],
        params: airlineIdentifierParamsSchema,
        response: { 200: workforceRecommendationsResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().recommendations(request.params.airlineId, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );
  app.get<{ Params: AirlineParams }>(
    "/v1/airlines/:airlineId/workforce/pools",
    {
      schema: {
        operationId: "listWorkforcePools",
        tags: ["workforce"],
        params: airlineIdentifierParamsSchema,
        response: { 200: workforcePoolsResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().listPools(request.params.airlineId, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );
  app.post<{ Params: AirlineParams; Body: WorkforceHireRequest; Headers: Headers }>(
    "/v1/airlines/:airlineId/workforce/hiring",
    {
      schema: {
        operationId: "hireWorkforce",
        tags: ["workforce"],
        params: airlineIdentifierParamsSchema,
        headers: idempotencyHeadersSchema,
        body: workforceHireRequestSchema,
        response: { 201: workforceHireResponseSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await required().hire(request.params.airlineId, request.body, commandContext(request)),
        ),
  );
  app.post<{ Params: AirlineParams; Body: WorkforceForecastRequest }>(
    "/v1/airlines/:airlineId/workforce/forecast",
    {
      schema: {
        operationId: "forecastWorkforce",
        tags: ["workforce"],
        params: airlineIdentifierParamsSchema,
        body: workforceForecastRequestSchema,
        response: { 200: workforceForecastResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().forecast(request.params.airlineId, new Date(request.body.through), {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );
  app.post<{ Params: FlightParams; Headers: Headers }>(
    "/v1/airlines/:airlineId/workforce/flights/:flightId/readiness",
    {
      schema: {
        operationId: "allocateFlightWorkforce",
        tags: ["workforce"],
        params: workforceFlightParamsSchema,
        headers: idempotencyHeadersSchema,
        response: { 200: workforceReadinessResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().allocateFlight(
        request.params.airlineId,
        request.params.flightId,
        commandContext(request),
      ),
  );
  app.post<{ Params: AirlineParams; Body: WorkforceWageAccrualRequest; Headers: Headers }>(
    "/v1/airlines/:airlineId/workforce/wages/accrue",
    {
      schema: {
        operationId: "accrueWorkforceWages",
        tags: ["workforce"],
        params: airlineIdentifierParamsSchema,
        headers: idempotencyHeadersSchema,
        body: workforceWageAccrualRequestSchema,
        response: { 200: workforceWageAccrualResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().accrueWages(
        request.params.airlineId,
        new Date(request.body.through),
        commandContext(request),
      ),
  );
}
