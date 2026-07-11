import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { readOptionalInteger, readOptionalString } from "@airline-manager/config";
import { createHealthResponse } from "@airline-manager/contracts";

export function createApiServer(): Server {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(createHealthResponse("api")));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
}

function start(): void {
  const host = readOptionalString("API_HOST") ?? "127.0.0.1";
  const port = readOptionalInteger("API_PORT") ?? 3001;
  createApiServer().listen(port, host, () => {
    process.stdout.write(`API listening on http://${host}:${port}\n`);
  });
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  start();
}
