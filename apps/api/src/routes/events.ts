import type { AuthorizationContext, NotificationService } from "@airline-manager/application";
import { errorEnvelopeSchema } from "@airline-manager/contracts";
import type { PlayerNotification } from "@airline-manager/domain";
import type { FastifyInstance } from "fastify";
import type { SseAuthorizationHook } from "../types.js";

type EventQuery = { cursor?: string };
type EventHeaders = { "last-event-id"?: string };
const cursorSchema = { type: "string", maxLength: 20, pattern: "^[0-9]+$" } as const;

export function formatSseConnectedEvent(cursor?: string, retryMs = 5_000): string {
  return `retry: ${retryMs}\nevent: connected\ndata: ${JSON.stringify({ cursor: cursor ?? null })}\n\n`;
}
export function formatSseNotification(notification: PlayerNotification): string {
  return `id: ${notification.eventId}\nevent: notification\ndata: ${JSON.stringify(notification)}\n\n`;
}

export function registerEventRoutes(
  app: FastifyInstance,
  options: {
    authorize: SseAuthorizationHook;
    notifications?: NotificationService;
    heartbeatMs: number;
    reconnectMs: number;
    pollMs?: number;
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
            description: "Authorized resumable advisory notification stream.",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
          400: errorEnvelopeSchema,
          401: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
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
      if (!options.notifications) throw new Error("Notification stream is unavailable.");
      const queryContext = {
        requestId: request.id,
        authorization: request.authorizationContext as AuthorizationContext,
      };
      let last = BigInt(cursor ?? "0");
      await options.notifications.list(last, 1, queryContext); // Authenticates before hijacking.
      reply.hijack();
      reply.raw.writeHead(200, {
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
        "x-request-id": request.id,
      });
      reply.raw.write(formatSseConnectedEvent(cursor, options.reconnectMs));
      let polling = false;
      const flush = async () => {
        if (polling || reply.raw.destroyed) return;
        polling = true;
        try {
          while (!reply.raw.destroyed) {
            const items = await options.notifications!.list(last, 100, queryContext);
            if (items.length === 0) break;
            for (const item of items) {
              reply.raw.write(formatSseNotification(item));
              last = BigInt(item.eventId);
            }
            if (items.length < 100) break;
          }
        } finally {
          polling = false;
        }
      };
      await flush();
      const poll = setInterval(
        () => void flush().catch(() => reply.raw.end()),
        options.pollMs ?? 1_000,
      );
      const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), options.heartbeatMs);
      poll.unref();
      heartbeat.unref();
      request.raw.once("close", () => {
        clearInterval(poll);
        clearInterval(heartbeat);
      });
    },
  );
}
