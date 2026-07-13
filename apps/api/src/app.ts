import { randomUUID } from "node:crypto";
import {
  anonymousAuthorizationContext,
  createApplicationServices,
  type ApplicationServices,
  type AirlineFoundingService,
  type FleetService,
  type FuelService,
  type MarketService,
  type SchedulingService,
  type WorkforceService,
  type MaintenanceService,
  type WeatherService,
  type FlightOperationsService,
  type NotificationService,
  type GetCurrentPublishedCatalogHandler,
} from "@airline-manager/application";
import type { Database } from "@airline-manager/database";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { registerErrorMapping } from "./errors.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerSystemRoutes, type ReadinessCheck } from "./routes/system.js";
import type { AuthorizationResolver, SseAuthorizationHook } from "./types.js";
import type { AuthenticationAdapter } from "./auth/better-auth.js";
import { registerAuthenticationRoutes } from "./auth/fastify.js";
import { registerAirlineRoutes } from "./routes/airlines.js";
import { registerFuelRoutes } from "./routes/fuel.js";
import { registerMarketRoutes } from "./routes/markets.js";
import { registerSchedulingRoutes } from "./routes/scheduling.js";
import { registerWorkforceRoutes } from "./routes/workforce.js";
import { registerMaintenanceRoutes } from "./routes/maintenance.js";
import { registerWeatherRoutes } from "./routes/weather.js";
import { registerFlightOperationsRoutes } from "./routes/operations.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerPublicRoutes } from "./routes/public.js";

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
  authentication?: Readonly<{ adapter: AuthenticationAdapter; database: Database }>;
  airlineFoundingService?: AirlineFoundingService;
  fleetService?: FleetService;
  fuelService?: FuelService;
  marketService?: MarketService;
  schedulingService?: SchedulingService;
  workforceService?: WorkforceService;
  maintenanceService?: MaintenanceService;
  weatherService?: WeatherService;
  flightOperationsService?: FlightOperationsService;
  notificationService?: NotificationService;
  currentCatalog?: GetCurrentPublishedCatalogHandler;
  googleSignInAvailable?: boolean;
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
        { name: "catalog", description: "Published playable reference data." },
        { name: "airlines", description: "Authenticated airline career commands and queries." },
        {
          name: "fleet",
          description: "Founder lease and individual aircraft commands and queries.",
        },
        { name: "fuel", description: "Global fuel market, inventory, reserves, and capacity." },
        {
          name: "markets",
          description: "Direct passenger demand, aggregate competition, pricing, and bookings.",
        },
        {
          name: "scheduling",
          description: "Direct routes, weekly timetables, rotations, and dated flights.",
        },
        { name: "workforce", description: "Qualified aggregate staffing, readiness, and wages." },
        {
          name: "maintenance",
          description:
            "Aircraft maintenance programs, utilization, condition, faults, and dispatch readiness.",
        },
        {
          name: "weather",
          description: "Deterministic route and departure operational weather planning.",
        },
        {
          name: "flight-operations",
          description:
            "Authoritative flight status, timeline, recovery, and settlement explanations.",
        },
        {
          name: "notifications",
          description: "Persisted in-game notification center and preferences.",
        },
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
    if (options.authentication) {
      registerAuthenticationRoutes(
        routes,
        options.authentication.adapter,
        options.authentication.database,
      );
    }
    registerSystemRoutes(routes, {
      applicationServices: options.applicationServices ?? createApplicationServices(),
      checkReadiness: options.checkReadiness ?? defaultReadiness,
    });
    registerPublicRoutes(routes, {
      googleSignInAvailable: options.googleSignInAvailable ?? false,
      ...(options.currentCatalog ? { catalog: options.currentCatalog } : {}),
    });
    registerAirlineRoutes(routes, options.airlineFoundingService, options.fleetService);
    registerFuelRoutes(routes, options.fuelService);
    registerMarketRoutes(routes, options.marketService);
    registerSchedulingRoutes(routes, options.schedulingService);
    registerWorkforceRoutes(routes, options.workforceService);
    registerMaintenanceRoutes(routes, options.maintenanceService);
    registerWeatherRoutes(routes, options.weatherService);
    registerFlightOperationsRoutes(routes, options.flightOperationsService);
    registerNotificationRoutes(routes, options.notificationService);
    registerEventRoutes(routes, {
      authorize: options.sseAuthorization ?? defaultSseAuthorization,
      ...(options.notificationService ? { notifications: options.notificationService } : {}),
      heartbeatMs: options.sseHeartbeatMs ?? 15_000,
      reconnectMs: options.sseReconnectMs ?? 5_000,
    });
  });
  registerErrorMapping(app);
  return app;
}
