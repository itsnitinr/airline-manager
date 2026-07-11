import { randomUUID } from "node:crypto";
import type { AirlineFoundingService, FleetService } from "@airline-manager/application";
import {
  aircraftIdentifierParamsSchema,
  airlineIdentifierParamsSchema,
  airlineSummaryResponseSchema,
  deliveryStatusResponseSchema,
  errorEnvelopeSchema,
  fleetAircraftResponseSchema,
  fleetListResponseSchema,
  founderLeaseAcceptanceResponseSchema,
  founderLeasePreviewResponseSchema,
  founderLeaseSelectionRequestSchema,
  founderPackageComparisonResponseSchema,
  foundingConfirmationResponseSchema,
  foundingPreviewResponseSchema,
  foundingSelectionRequestSchema,
  idempotencyHeadersSchema,
  type FounderLeaseSelectionRequest,
  type FoundingSelectionRequest,
} from "@airline-manager/contracts";
import type { FastifyInstance } from "fastify";

type CommandHeaders = { "idempotency-key": string };
type AirlineParams = { airlineId: string };
type AircraftParams = { airlineId: string; aircraftId: string };

export function registerAirlineRoutes(
  app: FastifyInstance,
  service?: AirlineFoundingService,
  fleetService?: FleetService,
): void {
  const required = (): AirlineFoundingService => {
    if (!service) throw new Error("Airline founding service is unavailable.");
    return service;
  };
  const requiredFleet = (): FleetService => {
    if (!fleetService) throw new Error("Fleet service is unavailable.");
    return fleetService;
  };

  app.post<{ Body: FoundingSelectionRequest }>(
    "/v1/airlines/founding/preview",
    {
      schema: {
        operationId: "previewAirlineFounding",
        tags: ["airlines"],
        body: foundingSelectionRequestSchema,
        response: {
          200: foundingPreviewResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      required().preview(request.body, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );

  app.post<{ Body: FoundingSelectionRequest; Headers: CommandHeaders }>(
    "/v1/airlines/founding/confirm",
    {
      schema: {
        operationId: "confirmAirlineFounding",
        tags: ["airlines"],
        headers: idempotencyHeadersSchema,
        body: foundingSelectionRequestSchema,
        response: {
          201: foundingConfirmationResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const commandId = randomUUID();
      const transactionId = randomUUID();
      request.log.info(
        { requestId: request.id, commandId, transactionId },
        "executing airline founding command",
      );
      const result = await required().confirm(request.body, {
        requestId: request.id,
        commandId,
        transactionId,
        idempotencyKey: request.headers["idempotency-key"],
        authorization: request.authorizationContext,
      });
      return reply.status(201).send(result);
    },
  );

  app.get<{ Params: AirlineParams }>(
    "/v1/airlines/:airlineId",
    {
      schema: {
        operationId: "getAirlineCareerSummary",
        tags: ["airlines"],
        params: airlineIdentifierParamsSchema,
        response: {
          200: airlineSummaryResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      required().summary(request.params.airlineId, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );

  app.get<{ Params: AirlineParams }>(
    "/v1/airlines/:airlineId/founder-package",
    {
      schema: {
        operationId: "listFounderPackage",
        tags: ["fleet"],
        params: airlineIdentifierParamsSchema,
        response: {
          200: founderPackageComparisonResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      requiredFleet().listFounderPackage(request.params.airlineId, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );

  app.post<{ Params: AirlineParams; Body: FounderLeaseSelectionRequest }>(
    "/v1/airlines/:airlineId/founder-package/preview",
    {
      schema: {
        operationId: "previewFounderLease",
        tags: ["fleet"],
        params: airlineIdentifierParamsSchema,
        body: founderLeaseSelectionRequestSchema,
        response: {
          200: founderLeasePreviewResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      requiredFleet().previewFounderLease(request.params.airlineId, request.body.optionCode, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );

  app.post<{ Params: AirlineParams; Body: FounderLeaseSelectionRequest; Headers: CommandHeaders }>(
    "/v1/airlines/:airlineId/founder-lease/accept",
    {
      schema: {
        operationId: "acceptFounderLease",
        tags: ["fleet"],
        params: airlineIdentifierParamsSchema,
        headers: idempotencyHeadersSchema,
        body: founderLeaseSelectionRequestSchema,
        response: {
          201: founderLeaseAcceptanceResponseSchema,
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const commandId = randomUUID();
      const transactionId = randomUUID();
      request.log.info(
        { requestId: request.id, commandId, transactionId },
        "executing founder lease command",
      );
      const result = await requiredFleet().acceptFounderLease(
        request.params.airlineId,
        request.body.optionCode,
        {
          requestId: request.id,
          commandId,
          transactionId,
          idempotencyKey: request.headers["idempotency-key"],
          authorization: request.authorizationContext,
        },
      );
      return reply.status(201).send(result);
    },
  );

  app.get<{ Params: AirlineParams }>(
    "/v1/airlines/:airlineId/fleet",
    {
      schema: {
        operationId: "listFleet",
        tags: ["fleet"],
        params: airlineIdentifierParamsSchema,
        response: {
          200: fleetListResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      requiredFleet().listFleet(request.params.airlineId, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );

  app.get<{ Params: AircraftParams }>(
    "/v1/airlines/:airlineId/fleet/:aircraftId",
    {
      schema: {
        operationId: "getFleetAircraft",
        tags: ["fleet"],
        params: aircraftIdentifierParamsSchema,
        response: {
          200: fleetAircraftResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request) =>
      requiredFleet().getAircraft(request.params.airlineId, request.params.aircraftId, {
        requestId: request.id,
        authorization: request.authorizationContext,
      }),
  );

  app.get<{ Params: AircraftParams }>(
    "/v1/airlines/:airlineId/fleet/:aircraftId/delivery-status",
    {
      schema: {
        operationId: "getAircraftDeliveryStatus",
        tags: ["fleet"],
        params: aircraftIdentifierParamsSchema,
        response: {
          200: deliveryStatusResponseSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const aircraft = await requiredFleet().getAircraft(
        request.params.airlineId,
        request.params.aircraftId,
        {
          requestId: request.id,
          authorization: request.authorizationContext,
        },
      );
      return {
        aircraftId: aircraft.id,
        deliveryState: aircraft.deliveryState,
        deliveryTargetAt: aircraft.deliveryTargetAt,
        deliveredAt: aircraft.deliveredAt,
        currentAirportId: aircraft.currentAirportId,
        plannedAirportId: aircraft.plannedAirportId,
        version: aircraft.version,
      };
    },
  );

  app.get<{ Params: AirlineParams }>(
    "/v1/airlines/:airlineId/next-step",
    {
      schema: {
        operationId: "getAirlineNextStepGuidance",
        tags: ["airlines"],
        params: airlineIdentifierParamsSchema,
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["nextStep", "nextStepGuidance"],
            properties: {
              nextStep: {
                type: "string",
                enum: ["select_founder_aircraft", "await_aircraft_delivery", "plan_first_route"],
              },
              nextStepGuidance: { type: "string" },
            },
          },
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      if (fleetService) {
        const fleet = await requiredFleet().listFleet(request.params.airlineId, {
          requestId: request.id,
          authorization: request.authorizationContext,
        });
        const aircraft = fleet[0];
        if (aircraft)
          return aircraft.deliveryState === "pending"
            ? {
                nextStep: "await_aircraft_delivery",
                nextStepGuidance:
                  "Wait for the persisted delivery target before using the aircraft.",
              }
            : {
                nextStep: "plan_first_route",
                nextStepGuidance:
                  "The founder aircraft is at the principal base and ready for route planning.",
              };
      }
      const summary = await required().summary(request.params.airlineId, {
        requestId: request.id,
        authorization: request.authorizationContext,
      });
      return { nextStep: summary.nextStep, nextStepGuidance: summary.nextStepGuidance };
    },
  );
}
