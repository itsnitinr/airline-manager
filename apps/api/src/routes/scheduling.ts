import { randomUUID } from "node:crypto";
import type { AuthorizationContext, SchedulingService } from "@airline-manager/application";
import {
  airlineIdentifierParamsSchema,
  errorEnvelopeSchema,
  horizonExtensionRequestSchema,
  idempotencyHeadersSchema,
  routeCreateRequestSchema,
  routeIdentifierParamsSchema,
  routeResearchQuerySchema,
  routeResearchSchedulingResponseSchema,
  routeResponseSchema,
  routesResponseSchema,
  timetableActivationRequestSchema,
  timetableActivationResponseSchema,
  timetableIdentifierParamsSchema,
  type HorizonExtensionRequest,
  type RouteCreateRequest,
  type TimetableActivationRequest,
} from "@airline-manager/contracts";
import type { FastifyInstance } from "fastify";

type AirlineParams = { airlineId: string };
type RouteParams = AirlineParams & { routeId: string };
type TimetableParams = AirlineParams & { timetableVersionId: string };
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

export function registerSchedulingRoutes(app: FastifyInstance, service?: SchedulingService): void {
  const required = () => {
    if (!service) throw new Error("Scheduling service is unavailable.");
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
    Querystring: { origin: string; destination: string; aircraftId: string; at?: string };
  }>(
    "/v1/airlines/:airlineId/routes/research",
    {
      schema: {
        operationId: "researchDirectRoute",
        tags: ["scheduling"],
        params: airlineIdentifierParamsSchema,
        querystring: routeResearchQuerySchema,
        response: { 200: routeResearchSchedulingResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().research(
        request.params.airlineId,
        request.query.origin,
        request.query.destination,
        request.query.aircraftId,
        request.query.at ? new Date(request.query.at) : undefined,
        { requestId: request.id, authorization: request.authorizationContext },
      ),
  );

  app.post<{ Params: AirlineParams; Body: RouteCreateRequest; Headers: Headers }>(
    "/v1/airlines/:airlineId/routes",
    {
      schema: {
        operationId: "createDirectRoute",
        tags: ["scheduling"],
        params: airlineIdentifierParamsSchema,
        headers: idempotencyHeadersSchema,
        body: routeCreateRequestSchema,
        response: { 201: routeResponseSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await required().createRoute(
            request.params.airlineId,
            request.body.originIataCode,
            request.body.destinationIataCode,
            request.body.aircraftId,
            commandContext(request),
          ),
        ),
  );

  app.get<{ Params: AirlineParams }>(
    "/v1/airlines/:airlineId/routes",
    {
      schema: {
        operationId: "listDirectRoutes",
        tags: ["scheduling"],
        params: airlineIdentifierParamsSchema,
        response: { 200: routesResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().listRoutes(request.params.airlineId, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );

  app.post<{ Params: RouteParams; Body: TimetableActivationRequest; Headers: Headers }>(
    "/v1/airlines/:airlineId/routes/:routeId/timetables",
    {
      schema: {
        operationId: "activateWeeklyTimetable",
        tags: ["scheduling"],
        params: routeIdentifierParamsSchema,
        headers: idempotencyHeadersSchema,
        body: timetableActivationRequestSchema,
        response: { 201: timetableActivationResponseSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await required().activateTimetable(
            request.params.airlineId,
            request.params.routeId,
            request.body,
            commandContext(request),
          ),
        ),
  );

  app.post<{ Params: TimetableParams; Body: HorizonExtensionRequest; Headers: Headers }>(
    "/v1/airlines/:airlineId/timetables/:timetableVersionId/horizon",
    {
      schema: {
        operationId: "extendTimetableHorizon",
        tags: ["scheduling"],
        params: timetableIdentifierParamsSchema,
        headers: idempotencyHeadersSchema,
        body: horizonExtensionRequestSchema,
        response: { 200: timetableActivationResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().extendHorizon(
        request.params.airlineId,
        request.params.timetableVersionId,
        new Date(`${request.body.through}T00:00:00Z`),
        commandContext(request),
      ),
  );
}
