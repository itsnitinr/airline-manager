import { randomUUID } from "node:crypto";
import type { ApplicationServices } from "@airline-manager/application";
import {
  createHealthResponse,
  createReadinessResponse,
  errorEnvelopeSchema,
  healthResponseSchema,
  idempotencyHeadersSchema,
  readinessResponseSchema,
  sampleCommandRequestSchema,
  sampleCommandResponseSchema,
  type SampleCommandRequest,
} from "@airline-manager/contracts";
import type { DependencyReadiness } from "@airline-manager/database";
import type { FastifyInstance } from "fastify";

export type ReadinessCheck = () => Promise<DependencyReadiness>;

type CommandHeaders = { "idempotency-key": string };

export function registerSystemRoutes(
  app: FastifyInstance,
  options: {
    applicationServices: ApplicationServices;
    checkReadiness: ReadinessCheck;
  },
): void {
  app.get(
    "/health",
    {
      schema: {
        operationId: "getHealth",
        tags: ["operations"],
        response: { 200: healthResponseSchema },
      },
    },
    async () => createHealthResponse("api"),
  );

  app.get(
    "/ready",
    {
      schema: {
        operationId: "getReadiness",
        tags: ["operations"],
        response: { 200: readinessResponseSchema, 503: readinessResponseSchema },
      },
    },
    async (_request, reply) => {
      let dependencies: DependencyReadiness;
      try {
        dependencies = await options.checkReadiness();
      } catch {
        dependencies = { postgres: false, redis: false };
      }
      const readiness = createReadinessResponse("api", dependencies);
      return reply.status(readiness.status === "ready" ? 200 : 503).send(readiness);
    },
  );

  app.post<{ Body: SampleCommandRequest; Headers: CommandHeaders }>(
    "/v1/system/commands/sample",
    {
      schema: {
        operationId: "executeSampleCommand",
        tags: ["system"],
        headers: idempotencyHeadersSchema,
        body: sampleCommandRequestSchema,
        response: {
          200: sampleCommandResponseSchema,
          400: errorEnvelopeSchema,
          429: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const commandId = randomUUID();
      const transactionId = randomUUID();
      request.log.info(
        { requestId: request.id, commandId, transactionId },
        "executing application command",
      );
      return options.applicationServices.sampleCommand.execute(request.body, {
        requestId: request.id,
        commandId,
        transactionId,
        idempotencyKey: request.headers["idempotency-key"],
        authorization: request.authorizationContext,
      });
    },
  );
}
