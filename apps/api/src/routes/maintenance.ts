import { randomUUID } from "node:crypto";
import type { AuthorizationContext, MaintenanceService } from "@airline-manager/application";
import {
  errorEnvelopeSchema,
  idempotencyHeadersSchema,
  maintenanceAircraftParamsSchema,
  maintenanceFlightCompletionRequestSchema,
  maintenanceFlightCompletionResponseSchema,
  maintenanceForecastResponseSchema,
  maintenanceHistoryResponseSchema,
  maintenanceProgramResponseSchema,
  maintenanceReadinessRequestSchema,
  maintenanceWindowRequestSchema,
  maintenanceWorkPackageParamsSchema,
  maintenanceWorkPackageResponseSchema,
  type MaintenanceFlightCompletionRequest,
  type MaintenanceReadinessRequest,
  type MaintenanceWindowRequest,
} from "@airline-manager/contracts";
import type { FastifyInstance } from "fastify";

type AircraftParams = { airlineId: string; aircraftId: string };
type WorkPackageParams = { airlineId: string; workPackageId: string };
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

export function registerMaintenanceRoutes(
  app: FastifyInstance,
  service?: MaintenanceService,
): void {
  const required = () => {
    if (!service) throw new Error("Maintenance service is unavailable.");
    return service;
  };
  const errors = {
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    409: errorEnvelopeSchema,
    500: errorEnvelopeSchema,
  } as const;
  const queryContext = (request: { id: string; authorizationContext: AuthorizationContext }) => ({
    requestId: request.id,
    authorization: request.authorizationContext,
  });

  app.get<{ Params: AircraftParams }>(
    "/v1/airlines/:airlineId/aircraft/:aircraftId/maintenance/program",
    {
      schema: {
        operationId: "getAircraftMaintenanceProgram",
        tags: ["maintenance"],
        params: maintenanceAircraftParamsSchema,
        response: { 200: maintenanceProgramResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().program(
        request.params.airlineId,
        request.params.aircraftId,
        queryContext(request),
      ),
  );
  app.post<{
    Params: AircraftParams;
    Body: MaintenanceFlightCompletionRequest;
    Headers: Headers;
  }>(
    "/v1/airlines/:airlineId/aircraft/:aircraftId/maintenance/flight-completions",
    {
      schema: {
        operationId: "recordAircraftMaintenanceUtilization",
        tags: ["maintenance"],
        params: maintenanceAircraftParamsSchema,
        headers: idempotencyHeadersSchema,
        body: maintenanceFlightCompletionRequestSchema,
        response: { 200: maintenanceFlightCompletionResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().recordFlightCompletion(
        request.params.airlineId,
        { aircraftId: request.params.aircraftId, ...request.body },
        commandContext(request),
      ),
  );
  app.post<{ Params: AircraftParams; Body: MaintenanceWindowRequest; Headers: Headers }>(
    "/v1/airlines/:airlineId/aircraft/:aircraftId/maintenance/windows",
    {
      schema: {
        operationId: "scheduleAircraftMaintenanceWork",
        tags: ["maintenance"],
        params: maintenanceAircraftParamsSchema,
        headers: idempotencyHeadersSchema,
        body: maintenanceWindowRequestSchema,
        response: { 201: maintenanceWorkPackageResponseSchema, ...errors },
      },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(
          await required().scheduleWork(
            request.params.airlineId,
            request.params.aircraftId,
            request.body,
            commandContext(request),
          ),
        ),
  );
  app.post<{ Params: WorkPackageParams; Headers: Headers }>(
    "/v1/airlines/:airlineId/maintenance/work-packages/:workPackageId/complete",
    {
      schema: {
        operationId: "completeAircraftMaintenanceWork",
        tags: ["maintenance"],
        params: maintenanceWorkPackageParamsSchema,
        headers: idempotencyHeadersSchema,
        response: { 200: maintenanceWorkPackageResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().completeWork(
        request.params.airlineId,
        request.params.workPackageId,
        commandContext(request),
      ),
  );
  app.get<{ Params: AircraftParams }>(
    "/v1/airlines/:airlineId/aircraft/:aircraftId/maintenance/forecast",
    {
      schema: {
        operationId: "getAircraftMaintenanceForecast",
        tags: ["maintenance"],
        params: maintenanceAircraftParamsSchema,
        response: { 200: maintenanceForecastResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().forecast(
        request.params.airlineId,
        request.params.aircraftId,
        queryContext(request),
      ),
  );
  app.get<{ Params: AircraftParams; Querystring: MaintenanceReadinessRequest }>(
    "/v1/airlines/:airlineId/aircraft/:aircraftId/maintenance/readiness",
    {
      schema: {
        operationId: "getAircraftMaintenanceDispatchReadiness",
        tags: ["maintenance"],
        params: maintenanceAircraftParamsSchema,
        querystring: maintenanceReadinessRequestSchema,
        response: { 200: maintenanceForecastResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().dispatchReadiness(
        request.params.airlineId,
        request.params.aircraftId,
        new Date(request.query.at),
        queryContext(request),
      ),
  );
  app.get<{ Params: AircraftParams }>(
    "/v1/airlines/:airlineId/aircraft/:aircraftId/maintenance/history",
    {
      schema: {
        operationId: "listAircraftMaintenanceHistory",
        tags: ["maintenance"],
        params: maintenanceAircraftParamsSchema,
        response: { 200: maintenanceHistoryResponseSchema, ...errors },
      },
    },
    async (request) =>
      required().history(
        request.params.airlineId,
        request.params.aircraftId,
        queryContext(request),
      ),
  );
}
