import type { AuthorizationContext, NotificationService } from "@airline-manager/application";
import {
  errorEnvelopeSchema,
  notificationListResponseSchema,
  notificationPreferencesSchema,
  notificationReadRequestSchema,
  playerNotificationSchema,
  type NotificationPreferencesRequest,
  type NotificationReadRequest,
} from "@airline-manager/contracts";
import type { FastifyInstance } from "fastify";

const context = (request: { id: string; authorizationContext: AuthorizationContext }) => ({
  requestId: request.id,
  authorization: request.authorizationContext,
});
const cursorSchema = { type: "string", pattern: "^[0-9]+$", maxLength: 20 } as const;

export function registerNotificationRoutes(
  app: FastifyInstance,
  service?: NotificationService,
): void {
  const required = () => {
    if (!service) throw new Error("Notification service is unavailable.");
    return service;
  };
  const errors = {
    400: errorEnvelopeSchema,
    401: errorEnvelopeSchema,
    403: errorEnvelopeSchema,
    500: errorEnvelopeSchema,
  } as const;
  app.get<{ Querystring: { cursor?: string; limit?: number } }>(
    "/v1/notifications",
    {
      schema: {
        operationId: "listNotifications",
        tags: ["notifications"],
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            cursor: cursorSchema,
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
        },
        response: { 200: notificationListResponseSchema, ...errors },
      },
    },
    async (request) => {
      const items = await required().list(
        BigInt(request.query.cursor ?? "0"),
        request.query.limit ?? 50,
        context(request),
      );
      return { items, nextCursor: items.at(-1)?.eventId ?? null };
    },
  );
  app.patch<{ Params: { notificationId: string }; Body: NotificationReadRequest }>(
    "/v1/notifications/:notificationId/read",
    {
      schema: {
        operationId: "setNotificationReadState",
        tags: ["notifications"],
        params: {
          type: "object",
          additionalProperties: false,
          required: ["notificationId"],
          properties: { notificationId: { type: "string", format: "uuid" } },
        },
        body: notificationReadRequestSchema,
        response: { 200: playerNotificationSchema, ...errors },
      },
    },
    (request) =>
      required().markRead(request.params.notificationId, request.body.read, context(request)),
  );
  app.get(
    "/v1/notification-preferences",
    {
      schema: {
        operationId: "getNotificationPreferences",
        tags: ["notifications"],
        response: { 200: notificationPreferencesSchema, ...errors },
      },
    },
    (request) => required().preferences(context(request)),
  );
  app.put<{ Body: NotificationPreferencesRequest }>(
    "/v1/notification-preferences",
    {
      schema: {
        operationId: "updateNotificationPreferences",
        tags: ["notifications"],
        body: notificationPreferencesSchema,
        response: { 200: notificationPreferencesSchema, ...errors },
      },
    },
    (request) => required().savePreferences(request.body, context(request)),
  );
}
