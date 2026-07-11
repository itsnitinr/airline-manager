import { createServer, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import {
  readOptionalInteger,
  readOptionalString,
  readRequiredString,
} from "@airline-manager/config";
import { createHealthResponse, createReadinessResponse } from "@airline-manager/contracts";
import {
  createInfrastructureReadinessCheck,
  type DependencyReadiness,
} from "@airline-manager/database";

export type ReadinessCheck = () => Promise<DependencyReadiness>;

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function createApiServer(
  checkReadiness: ReadinessCheck = async () => ({ postgres: true, redis: true }),
): Server {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      writeJson(response, 200, createHealthResponse("api"));
      return;
    }

    if (request.method === "GET" && request.url === "/ready") {
      void checkReadiness()
        .then((dependencies) => {
          const readiness = createReadinessResponse("api", dependencies);
          writeJson(response, readiness.status === "ready" ? 200 : 503, readiness);
        })
        .catch(() => {
          writeJson(
            response,
            503,
            createReadinessResponse("api", { postgres: false, redis: false }),
          );
        });
      return;
    }

    writeJson(response, 404, { error: "not_found" });
  });
}

export function startApi(environment = process.env): Server {
  const host = readOptionalString("API_HOST", environment) ?? "127.0.0.1";
  const port = readOptionalInteger("API_PORT", environment) ?? 3001;
  const checkReadiness = createInfrastructureReadinessCheck({
    databaseUrl: readRequiredString("DATABASE_URL", environment),
    redisUrl: readRequiredString("REDIS_URL", environment),
  });
  const server = createApiServer(checkReadiness);
  server.listen(port, host, () => {
    process.stdout.write(`API listening on ${host}:${port}\n`);
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`API received ${signal}; draining connections\n`);
    server.close((error) => {
      if (error) {
        process.stderr.write("API shutdown failed\n");
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return server;
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  startApi();
}
