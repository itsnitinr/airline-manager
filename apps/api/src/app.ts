import { randomUUID } from "node:crypto";
import {
  anonymousAuthorizationContext,
  createApplicationServices,
  type ApplicationServices,
} from "@airline-manager/application";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { registerErrorMapping } from "./errors.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerSystemRoutes, type ReadinessCheck } from "./routes/system.js";
import type { AuthorizationResolver, SseAuthorizationHook } from "./types.js";

export type ApiAppOptions = Readonly<{
  applicationServices?: ApplicationServices;
  checkReadiness?: ReadinessCheck;
  authorizationResolver?: AuthorizationResolver;
  sseAuthorization?: SseAuthorizationHook;
  corsOrigins?: readonly string[];
  rateLimitMax?: number;
  sseHeartbeatMs?: number;
  sseReconnectMs?: number;
  logger?: FastifyServerOptions["logger"];
}>;

const defaultReadiness: ReadinessCheck = async () => ({ postgres: true, redis: true });
const defaultAuthorizationResolver: AuthorizationResolver = async () =>
  anonymousAuthorizationContext;
const defaultSseAuthorization: SseAuthorizationHook = async () => undefined;

export function createApiServer(options: ApiAppOptions = {}): FastifyInstance {
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger:
      options.logger ??
      ({
        level: process.env.LOG_LEVEL ?? "info",
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.headers.idempotency-key",
            "req.headers.x-api-key",
            "request.headers.authorization",
            "request.headers.cookie",
            "request.headers.idempotency-key",
            "request.headers.x-api-key",
          ],
          censor: "[REDACTED]",
        },
      } satisfies FastifyServerOptions["logger"]),
  });

  void app.register(swagger, {
    openapi: {
      info: {
        title: "Airline Manager API",
        description: "Versioned transport contract for Airline Manager.",
        version: "1.0.0",
      },
      servers: [{ url: "/", description: "Current origin" }],
      tags: [
        { name: "operations", description: "Process health and readiness." },
        { name: "system", description: "Non-gameplay application shell operations." },
        { name: "events", description: "Recoverable advisory event stream." },
      ],
    },
  });
  void app.register(helmet);
  void app.register(cors, {
    origin: [...(options.corsOrigins ?? ["http://localhost:3000"])],
    credentials: true,
  });
  void app.register(rateLimit, {
    global: true,
    max: options.rateLimitMax ?? 120,
    timeWindow: "1 minute",
  });

  app.addHook("onRequest", async (request) => {
    request.authorizationContext = await (
      options.authorizationResolver ?? defaultAuthorizationResolver
    )({ requestId: request.id, headers: request.headers });
  });
  app.addHook("onSend", async (request, reply) => {
    void reply.header("x-request-id", request.id);
  });

  void app.register(async (routes) => {
    registerSystemRoutes(routes, {
      applicationServices: options.applicationServices ?? createApplicationServices(),
      checkReadiness: options.checkReadiness ?? defaultReadiness,
    });
    registerEventRoutes(routes, {
      authorize: options.sseAuthorization ?? defaultSseAuthorization,
      heartbeatMs: options.sseHeartbeatMs ?? 15_000,
      reconnectMs: options.sseReconnectMs ?? 5_000,
    });
  });
  registerErrorMapping(app);
  return app;
}
