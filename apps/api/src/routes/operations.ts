import type { AuthorizationContext, FlightOperationsService } from "@airline-manager/application";
import {
  errorEnvelopeSchema,
  flightBoardResponseSchema,
  flightOperationsParamsSchema,
  flightSettlementResponseSchema,
  flightStatusResponseSchema,
  offlineFlightChangesResponseSchema,
} from "@airline-manager/contracts";
import type { FastifyInstance } from "fastify";

type Params = { airlineId: string; flightId: string };
const context = (request: { id: string; authorizationContext: AuthorizationContext }) => ({
  requestId: request.id,
  authorization: request.authorizationContext,
});

export function registerFlightOperationsRoutes(
  app: FastifyInstance,
  service?: FlightOperationsService,
): void {
  const required = () => {
    if (!service) throw new Error("Flight operations service is unavailable.");
    return service;
  };
  const errors = {
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
    500: errorEnvelopeSchema,
  } as const;
  app.get<{
    Params: { airlineId: string };
    Querystring: {
      from: string;
      to: string;
      state?: string;
      routeId?: string;
      aircraftId?: string;
      limit?: number;
    };
  }>(
    "/v1/airlines/:airlineId/operations/flights",
    {
      schema: {
        operationId: "listOperationalFlights",
        tags: ["flight-operations"],
        params: {
          type: "object",
          required: ["airlineId"],
          properties: { airlineId: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["from", "to"],
          properties: {
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            state: { type: "string" },
            routeId: { type: "string", format: "uuid" },
            aircraftId: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
          },
        },
        response: { 200: flightBoardResponseSchema, ...errors },
      },
    },
    (request) =>
      required().board(
        request.params.airlineId,
        {
          from: new Date(request.query.from),
          to: new Date(request.query.to),
          ...(request.query.state ? { states: request.query.state.split(",") as never } : {}),
          ...(request.query.routeId ? { routeId: request.query.routeId } : {}),
          ...(request.query.aircraftId ? { aircraftId: request.query.aircraftId } : {}),
          limit: request.query.limit ?? 100,
        },
        context(request),
      ),
  );
  app.get<{ Params: { airlineId: string }; Querystring: { since: string; limit?: number } }>(
    "/v1/airlines/:airlineId/operations/changes",
    {
      schema: {
        operationId: "listOfflineOperationalChanges",
        tags: ["flight-operations"],
        params: {
          type: "object",
          required: ["airlineId"],
          properties: { airlineId: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["since"],
          properties: {
            since: { type: "string", format: "date-time" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
        },
        response: { 200: offlineFlightChangesResponseSchema, ...errors },
      },
    },
    (request) =>
      required().changes(
        request.params.airlineId,
        new Date(request.query.since),
        request.query.limit ?? 50,
        context(request),
      ),
  );
  app.get<{ Params: Params }>(
    "/v1/airlines/:airlineId/flights/:flightId/status",
    {
      schema: {
        operationId: "getFlightStatus",
        tags: ["flight-operations"],
        params: flightOperationsParamsSchema,
        response: { 200: flightStatusResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().status(request.params.airlineId, request.params.flightId, context(request)),
  );
  app.get<{ Params: Params }>(
    "/v1/airlines/:airlineId/flights/:flightId/settlement",
    {
      schema: {
        operationId: "getFlightSettlement",
        tags: ["flight-operations"],
        params: flightOperationsParamsSchema,
        response: { 200: flightSettlementResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().settlement(request.params.airlineId, request.params.flightId, context(request)),
  );
}
