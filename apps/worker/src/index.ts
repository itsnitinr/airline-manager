import { createServer, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import type {
  ApplicationServices,
  CommandContext,
  SampleCommand,
  SampleCommandResult,
} from "@airline-manager/application";
import {
  readOptionalInteger,
  readOptionalString,
  readRequiredString,
} from "@airline-manager/config";
import {
  createHealthResponse,
  createReadinessResponse,
  type HealthResponse,
} from "@airline-manager/contracts";
import {
  createDatabaseRuntime,
  createInfrastructureReadinessCheck,
  readDatabasePoolOptions,
  type DependencyReadiness,
} from "@airline-manager/database";
import { SimulationWorkerRuntime } from "./runtime.js";

export type ReadinessCheck = () => Promise<DependencyReadiness>;

export function executeWorkerSampleCommand(
  services: ApplicationServices,
  command: SampleCommand,
  context: CommandContext,
): Promise<SampleCommandResult> {
  return services.sampleCommand.execute(command, context);
}

export function workerHealth(): HealthResponse {
  return createHealthResponse("worker");
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function createWorkerHealthServer(
  checkReadiness: ReadinessCheck = async () => ({ postgres: true, redis: true }),
  runtimeStatus: () => Readonly<{
    draining: boolean;
    ready: boolean;
    active: number;
    lag: unknown;
  }> = () => ({
    draining: false,
    ready: true,
    active: 0,
    lag: {},
  }),
  metrics: () => string = () => "",
): Server {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      writeJson(response, 200, workerHealth());
      return;
    }
    if (request.method === "GET" && request.url === "/ready") {
      void checkReadiness()
        .then((dependencies) => {
          const readiness = createReadinessResponse("worker", dependencies);
          const runtime = runtimeStatus();
          const ready = readiness.status === "ready" && runtime.ready && !runtime.draining;
          writeJson(response, ready ? 200 : 503, {
            ...readiness,
            status: ready ? "ready" : "not_ready",
            runtime,
          });
        })
        .catch(() => {
          writeJson(
            response,
            503,
            createReadinessResponse("worker", { postgres: false, redis: false }),
          );
        });
      return;
    }
    if (request.method === "GET" && request.url === "/metrics") {
      response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
      response.end(metrics());
      return;
    }
    writeJson(response, 404, { error: "not_found" });
  });
}

export function startWorker(environment = process.env): Server {
  const host = readOptionalString("WORKER_HEALTH_HOST", environment) ?? "127.0.0.1";
  const port = readOptionalInteger("WORKER_HEALTH_PORT", environment) ?? 3002;
  const databaseRuntime = createDatabaseRuntime(readDatabasePoolOptions("worker", environment));
  const checkReadiness = createInfrastructureReadinessCheck({
    databaseRuntime,
    redisUrl: readRequiredString("REDIS_URL", environment),
  });
  const concurrency = readOptionalInteger("WORKER_CONCURRENCY", environment);
  const drainMilliseconds = readOptionalInteger("WORKER_DRAIN_MILLISECONDS", environment);
  const pollMilliseconds = readOptionalInteger("WORKER_POLL_MILLISECONDS", environment);
  const runtime = new SimulationWorkerRuntime({
    databaseRuntime,
    redisUrl: readRequiredString("REDIS_URL", environment),
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(drainMilliseconds === undefined ? {} : { drainMilliseconds }),
    ...(pollMilliseconds === undefined ? {} : { pollMilliseconds }),
  });
  const server = createWorkerHealthServer(
    checkReadiness,
    () => runtime.status(),
    () => runtime.metrics.render(runtime.drain.draining, runtime.drain.active),
  );
  server.listen(port, host, () => {
    process.stdout.write(`${JSON.stringify(workerHealth())}\n`);
    process.stdout.write(`Worker health server listening on ${host}:${port}\n`);
    void runtime.start().catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({ level: "error", service: "worker", event: "startup_failed", message: error instanceof Error ? error.message : "unknown" })}\n`,
      );
      process.exitCode = 1;
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`Worker received ${signal}; draining work\n`);
    void runtime
      .shutdown()
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      )
      .then(() => databaseRuntime.destroy())
      .catch(() => {
        process.stderr.write("Worker runtime shutdown failed\n");
        process.exitCode = 1;
      });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return server;
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  startWorker();
}
