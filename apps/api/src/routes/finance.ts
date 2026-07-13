import type { AuthorizationContext, FinanceQueryService } from "@airline-manager/application";
import {
  errorEnvelopeSchema,
  financeOverviewResponseSchema,
  financeStatementsResponseSchema,
  journalPageResponseSchema,
} from "@airline-manager/contracts";
import type { FastifyInstance } from "fastify";

const context = (request: { id: string; authorizationContext: AuthorizationContext }) => ({
  requestId: request.id,
  authorization: request.authorizationContext,
});
const params = {
  type: "object",
  required: ["airlineId"],
  properties: { airlineId: { type: "string", format: "uuid" } },
} as const;
const errors = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  500: errorEnvelopeSchema,
} as const;

export function registerFinanceRoutes(app: FastifyInstance, service?: FinanceQueryService): void {
  const required = () => {
    if (!service) throw new Error("Finance query service is unavailable.");
    return service;
  };
  app.get<{ Params: { airlineId: string } }>(
    "/v1/airlines/:airlineId/finance/overview",
    {
      schema: {
        operationId: "getFinanceOverview",
        tags: ["finance"],
        params,
        response: { 200: financeOverviewResponseSchema, ...errors },
      },
    },
    (request) => required().overview(request.params.airlineId, context(request)),
  );
  app.get<{ Params: { airlineId: string }; Querystring: { from: string; to: string } }>(
    "/v1/airlines/:airlineId/finance/statements",
    {
      schema: {
        operationId: "getFinanceStatements",
        tags: ["finance"],
        params,
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["from", "to"],
          properties: {
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
          },
        },
        response: { 200: financeStatementsResponseSchema, ...errors },
      },
    },
    (request) =>
      required().statements(
        request.params.airlineId,
        new Date(request.query.from),
        new Date(request.query.to),
        context(request),
      ),
  );
  app.get<{
    Params: { airlineId: string };
    Querystring: { cursor?: number; limit?: number };
  }>(
    "/v1/airlines/:airlineId/finance/journals",
    {
      schema: {
        operationId: "listFinanceJournals",
        tags: ["finance"],
        params,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            cursor: { type: "integer", minimum: 0, default: 0 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
          },
        },
        response: { 200: journalPageResponseSchema, ...errors },
      },
    },
    (request) =>
      required().journals(
        request.params.airlineId,
        request.query.cursor ?? 0,
        request.query.limit ?? 25,
        context(request),
      ),
  );
}
