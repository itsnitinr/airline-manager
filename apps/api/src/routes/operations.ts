import type { AuthorizationContext, FlightOperationsService } from "@airline-manager/application";
import {
  errorEnvelopeSchema,
  flightOperationsParamsSchema,
  flightSettlementResponseSchema,
  flightStatusResponseSchema,
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
