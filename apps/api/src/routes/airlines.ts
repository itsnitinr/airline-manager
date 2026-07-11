import { randomUUID } from "node:crypto";
import type { AirlineFoundingService } from "@airline-manager/application";
import {
  airlineIdentifierParamsSchema,
  airlineSummaryResponseSchema,
  errorEnvelopeSchema,
  foundingConfirmationResponseSchema,
  foundingPreviewResponseSchema,
  foundingSelectionRequestSchema,
  idempotencyHeadersSchema,
  type FoundingSelectionRequest,
} from "@airline-manager/contracts";
import type { FastifyInstance } from "fastify";

type CommandHeaders = { "idempotency-key": string };
type AirlineParams = { airlineId: string };

export function registerAirlineRoutes(
  app: FastifyInstance,
  service?: AirlineFoundingService,
): void {
  const required = (): AirlineFoundingService => {
    if (!service) throw new Error("Airline founding service is unavailable.");
    return service;
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
              nextStep: { type: "string", const: "select_founder_aircraft" },
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
      const summary = await required().summary(request.params.airlineId, {
        requestId: request.id,
        authorization: request.authorizationContext,
      });
      return { nextStep: summary.nextStep, nextStepGuidance: summary.nextStepGuidance };
    },
  );
}
