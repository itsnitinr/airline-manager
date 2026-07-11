import { errorEnvelopeSchema } from "@airline-manager/contracts";
import type { FastifyInstance } from "fastify";
import type { SseAuthorizationHook } from "../types.js";

type EventQuery = { cursor?: string };
type EventHeaders = { "last-event-id"?: string };

const cursorSchema = {
  type: "string",
  minLength: 1,
  maxLength: 512,
  pattern: "^[A-Za-z0-9._:-]+$",
} as const;

export function formatSseConnectedEvent(cursor?: string, retryMs = 5_000): string {
  const id = cursor ?? "0";
  return `retry: ${retryMs}\nid: ${id}\nevent: connected\ndata: ${JSON.stringify({ cursor: cursor ?? null })}\n\n`;
}

export function registerEventRoutes(
  app: FastifyInstance,
  options: {
    authorize: SseAuthorizationHook;
    heartbeatMs: number;
    reconnectMs: number;
  },
): void {
  app.get<{ Querystring: EventQuery; Headers: EventHeaders }>(
    "/v1/events",
    {
      schema: {
        operationId: "subscribeToEvents",
        tags: ["events"],
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { cursor: cursorSchema },
        },
        headers: {
          type: "object",
          additionalProperties: true,
          properties: { "last-event-id": cursorSchema },
        },
        response: {
          200: {
            description: "Recoverable Server-Sent Events stream.",
            content: {
              "text/event-stream": {
                schema: { type: "string" },
              },
            },
          },
          400: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const cursor = request.headers["last-event-id"] ?? request.query.cursor;
      await options.authorize({
        authorization: request.authorizationContext,
        ...(cursor ? { cursor } : {}),
      });

      reply.hijack();
      reply.raw.writeHead(200, {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
        "x-request-id": request.id,
      });
      reply.raw.write(formatSseConnectedEvent(cursor, options.reconnectMs));

      const heartbeat = setInterval(() => {
        reply.raw.write(": heartbeat\n\n");
      }, options.heartbeatMs);
      heartbeat.unref();
      request.raw.once("close", () => clearInterval(heartbeat));
    },
  );
}
