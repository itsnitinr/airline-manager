import { pathToFileURL } from "node:url";
import {
  readOptionalInteger,
  readOptionalString,
  readRequiredString,
} from "@airline-manager/config";
import {
  createDatabaseRuntime,
  createInfrastructureReadinessCheck,
  readDatabasePoolOptions,
} from "@airline-manager/database";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "./app.js";

export { createApiServer } from "./app.js";
export { createOpenApiDocument } from "./openapi.js";
export type { ApiAppOptions } from "./app.js";

function readCorsOrigins(environment: NodeJS.ProcessEnv): readonly string[] {
  const configured = readOptionalString("API_CORS_ORIGINS", environment);
  return (
    configured
      ?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? ["http://localhost:3000"]
  );
}

export async function startApi(environment = process.env): Promise<FastifyInstance> {
  const host = readOptionalString("API_HOST", environment) ?? "127.0.0.1";
  const port = readOptionalInteger("API_PORT", environment) ?? 3001;
  const databaseRuntime = createDatabaseRuntime(readDatabasePoolOptions("api", environment));
  const checkReadiness = createInfrastructureReadinessCheck({
    databaseRuntime,
    redisUrl: readRequiredString("REDIS_URL", environment),
  });
  const rateLimitMax = readOptionalInteger("API_RATE_LIMIT_MAX", environment);
  const sseHeartbeatMs = readOptionalInteger("API_SSE_HEARTBEAT_MS", environment);
  const app = createApiServer({
    checkReadiness,
    corsOrigins: readCorsOrigins(environment),
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
