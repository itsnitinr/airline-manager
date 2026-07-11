import { pathToFileURL } from "node:url";
import { createHealthResponse, type HealthResponse } from "@airline-manager/contracts";

export function workerHealth(): HealthResponse {
  return createHealthResponse("worker");
}

function start(): void {
  process.stdout.write(`${JSON.stringify(workerHealth())}\n`);
  setInterval(() => undefined, 60_000);
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  start();
}
