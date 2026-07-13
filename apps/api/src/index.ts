import { pathToFileURL } from "node:url";
import {
  readOptionalInteger,
  readOptionalString,
  readRequiredString,
} from "@airline-manager/config";
import {
  KyselyAirlineFoundingRepository,
  KyselyFleetRepository,
  KyselyFuelRepository,
  KyselyIdentityRepository,
  KyselyMarketRepository,
  KyselySchedulingRepository,
  KyselyWorkforceRepository,
  KyselyMaintenanceRepository,
  KyselyWeatherRepository,
  KyselyFlightOperationsRepository,
  createDatabaseRuntime,
  createInfrastructureReadinessCheck,
  readDatabasePoolOptions,
} from "@airline-manager/database";
import {
  AirlineFoundingService,
  FleetService,
  FuelService,
  MarketService,
  SchedulingService,
  WorkforceService,
  MaintenanceService,
  WeatherService,
  FlightOperationsService,
} from "@airline-manager/application";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "./app.js";
import { createAuthenticationAdapter } from "./auth/better-auth.js";
import { createAuthorizationResolver } from "./auth/authorization.js";
import {
  CapturingAuthenticationEmailDelivery,
  type AuthenticationEmailDelivery,
} from "./auth/email.js";

export { createApiServer } from "./app.js";
export { createOpenApiDocument } from "./openapi.js";
export type { ApiAppOptions } from "./app.js";
export {
  createAuthenticationAdapter,
  type AuthenticationAdapter,
  type AuthenticationAdapterOptions,
} from "./auth/better-auth.js";
export {
  CapturingAuthenticationEmailDelivery,
  type AuthenticationEmail,
  type AuthenticationEmailDelivery,
} from "./auth/email.js";

export function readGoogleProvider(environment: NodeJS.ProcessEnv) {
  const clientId = readOptionalString("GOOGLE_OAUTH_CLIENT_ID", environment);
  const clientSecret = readOptionalString("GOOGLE_OAUTH_CLIENT_SECRET", environment);
  if ((clientId && !clientSecret) || (!clientId && clientSecret)) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be configured together.",
    );
  }
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

function readSecureCookies(environment: NodeJS.ProcessEnv, baseUrl: string): boolean {
  const configured = readOptionalString("AUTH_COOKIE_SECURE", environment);
  if (configured === undefined) return baseUrl.startsWith("https://");
  if (configured === "true") return true;
  if (configured === "false") return false;
  throw new Error("AUTH_COOKIE_SECURE must be true or false.");
}

function readCorsOrigins(environment: NodeJS.ProcessEnv): readonly string[] {
  const configured = readOptionalString("API_CORS_ORIGINS", environment);
  return (
    configured
      ?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? ["http://localhost:3000"]
  );
}

export async function startApi(
  environment = process.env,
  dependencies: Readonly<{ authenticationEmailDelivery?: AuthenticationEmailDelivery }> = {},
): Promise<FastifyInstance> {
  const host = readOptionalString("API_HOST", environment) ?? "127.0.0.1";
  const port = readOptionalInteger("API_PORT", environment) ?? 3001;
  const databaseRuntime = createDatabaseRuntime(readDatabasePoolOptions("api", environment));
  const checkReadiness = createInfrastructureReadinessCheck({
    databaseRuntime,
    redisUrl: readRequiredString("REDIS_URL", environment),
  });
  const rateLimitMax = readOptionalInteger("API_RATE_LIMIT_MAX", environment);
  const sseHeartbeatMs = readOptionalInteger("API_SSE_HEARTBEAT_MS", environment);
  const corsOrigins = readCorsOrigins(environment);
  const authBaseUrl = readOptionalString("BETTER_AUTH_URL", environment) ?? "http://localhost:3001";
  const emailDelivery =
    dependencies.authenticationEmailDelivery ?? new CapturingAuthenticationEmailDelivery();
  const google = readGoogleProvider(environment);
  const authenticationAdapter = createAuthenticationAdapter({
    database: databaseRuntime.database,
    pool: databaseRuntime.pool,
    baseUrl: authBaseUrl,
    secret: readRequiredString("BETTER_AUTH_SECRET", environment),
    trustedOrigins: corsOrigins,
    secureCookies: readSecureCookies(environment, authBaseUrl),
    emailDelivery,
    ...(google ? { google } : {}),
  });
  const app = createApiServer({
    checkReadiness,
    corsOrigins,
    authentication: { adapter: authenticationAdapter, database: databaseRuntime.database },
    authorizationResolver: createAuthorizationResolver(
      authenticationAdapter,
      databaseRuntime.database,
    ),
    airlineFoundingService: new AirlineFoundingService(
      new KyselyAirlineFoundingRepository(databaseRuntime.database),
      new KyselyIdentityRepository(databaseRuntime.database),
    ),
    fleetService: new FleetService(
      new KyselyFleetRepository(databaseRuntime.database),
      new KyselyIdentityRepository(databaseRuntime.database),
    ),
    fuelService: new FuelService(
      new KyselyFuelRepository(databaseRuntime.database),
      new KyselyIdentityRepository(databaseRuntime.database),
    ),
    marketService: new MarketService(
      new KyselyMarketRepository(databaseRuntime.database),
      new KyselyIdentityRepository(databaseRuntime.database),
    ),
    schedulingService: new SchedulingService(
      new KyselySchedulingRepository(databaseRuntime.database),
      new KyselyMarketRepository(databaseRuntime.database),
      new KyselyIdentityRepository(databaseRuntime.database),
    ),
    workforceService: new WorkforceService(
      new KyselyWorkforceRepository(databaseRuntime.database),
      new KyselyIdentityRepository(databaseRuntime.database),
    ),
    maintenanceService: new MaintenanceService(
      new KyselyMaintenanceRepository(databaseRuntime.database),
      new KyselyIdentityRepository(databaseRuntime.database),
    ),
    weatherService: new WeatherService(
      new KyselyWeatherRepository(databaseRuntime.database),
      new KyselyIdentityRepository(databaseRuntime.database),
    ),
    flightOperationsService: new FlightOperationsService(
      new KyselyFlightOperationsRepository(databaseRuntime.database),
      new KyselyIdentityRepository(databaseRuntime.database),
    ),
    ...(rateLimitMax === undefined ? {} : { rateLimitMax }),
    ...(sseHeartbeatMs === undefined ? {} : { sseHeartbeatMs }),
  });
  await app.listen({ port, host });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "API draining connections");
    try {
      await app.close();
      await databaseRuntime.destroy();
    } catch {
      app.log.error({ signal }, "API shutdown failed");
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  return app;
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void startApi().catch((error: unknown) => {
    process.stderr.write(
      `API startup failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}
