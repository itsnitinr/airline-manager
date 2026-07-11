import { Writable } from "node:stream";
import type { ApplicationServices } from "@airline-manager/application";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiServer, createOpenApiDocument, readGoogleProvider } from "./index.js";
import { formatSseConnectedEvent } from "./routes/events.js";

const apps = new Set<FastifyInstance>();

function track(app: FastifyInstance): FastifyInstance {
  apps.add(app);
  return app;
}

afterEach(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  apps.clear();
});

describe("Fastify API shell", () => {
  it("accepts only complete environment-provided Google credentials", () => {
    expect(readGoogleProvider({})).toBeUndefined();
    expect(
      readGoogleProvider({
        GOOGLE_OAUTH_CLIENT_ID: "fake-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "fake-secret",
      }),
    ).toEqual({ clientId: "fake-client", clientSecret: "fake-secret" });
    expect(() => readGoogleProvider({ GOOGLE_OAUTH_CLIENT_ID: "partial" })).toThrow(
      "must be configured together",
    );
  });

  it("preserves public health and dependency-aware readiness", async () => {
    const app = track(
      createApiServer({
        logger: false,
        checkReadiness: async () => ({ postgres: true, redis: false }),
      }),
    );

    const health = await app.inject({ method: "GET", url: "/health" });
    const readiness = await app.inject({ method: "GET", url: "/ready" });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ service: "api", status: "ok" });
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toEqual({
      service: "api",
      status: "not_ready",
      dependencies: { postgres: "up", redis: "down" },
    });
  });

  it("rejects invalid command requests before the application handler runs", async () => {
    const execute = vi.fn<ApplicationServices["sampleCommand"]["execute"]>();
    const app = track(
      createApiServer({ logger: false, applicationServices: { sampleCommand: { execute } } }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/system/commands/sample",
      headers: { "idempotency-key": "request-key-123" },
      payload: { message: "", unexpected: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "validation_error",
        message: expect.any(String),
        requestId: expect.any(String),
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("adapts a versioned HTTP command to the framework-independent service", async () => {
    const app = track(createApiServer({ logger: false }));

    const response = await app.inject({
      method: "POST",
      url: "/v1/system/commands/sample",
      headers: { "idempotency-key": "request-key-123" },
      payload: { message: "transport adapter" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBeTruthy();
    expect(response.json()).toMatchObject({
      message: "transport adapter",
      commandId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      transactionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      executedAt: expect.any(String),
    });
  });

  it("maps not-found and unexpected errors to standard envelopes", async () => {
    const execute = vi.fn<ApplicationServices["sampleCommand"]["execute"]>();
    execute.mockRejectedValue(new Error("private failure detail"));
    const app = track(
      createApiServer({ logger: false, applicationServices: { sampleCommand: { execute } } }),
    );

    const missing = await app.inject({ method: "GET", url: "/missing" });
    const failed = await app.inject({
      method: "POST",
      url: "/v1/system/commands/sample",
      headers: { "idempotency-key": "request-key-123" },
      payload: { message: "fail safely" },
    });

    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: "not_found" } });
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toMatchObject({
      error: { code: "internal_error", message: "An unexpected error occurred." },
    });
    expect(failed.body).not.toContain("private failure detail");
  });

  it("applies security headers, CORS, and rate limiting", async () => {
    const app = track(
      createApiServer({ logger: false, corsOrigins: ["https://web.example"], rateLimitMax: 1 }),
    );

    const first = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://web.example" },
    });
    const second = await app.inject({ method: "GET", url: "/health" });

    expect(first.headers["access-control-allow-origin"]).toBe("https://web.example");
    expect(first.headers["x-content-type-options"]).toBe("nosniff");
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({ error: { code: "rate_limited" } });
  });

  it("correlates IDs in structured logs while redacting request secrets", async () => {
    let logs = "";
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs += chunk.toString();
        callback();
      },
    });
    const app = track(createApiServer({ logger: { level: "info", stream } }));

    await app.inject({
      method: "POST",
      url: "/v1/system/commands/sample",
      headers: {
        authorization: "Bearer should-never-appear",
        cookie: "session=should-never-appear",
        "idempotency-key": "secret-key-123",
      },
      payload: { message: "correlate" },
    });

    expect(logs).toContain("requestId");
    expect(logs).toContain("commandId");
    expect(logs).toContain("transactionId");
    expect(logs).not.toContain("should-never-appear");
    expect(logs).not.toContain("secret-key-123");
  });

  it("provides a cursor-aware SSE shell and authorization hook", async () => {
    const authorize = vi.fn(async () => undefined);
    const app = track(
      createApiServer({ logger: false, sseAuthorization: authorize, sseHeartbeatMs: 50 }),
    );
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/events?cursor=event-42`, {
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    const firstChunk = await reader?.read();
    const heartbeatChunk = await reader?.read();
    controller.abort();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(new TextDecoder().decode(firstChunk?.value)).toContain("id: event-42");
    expect(new TextDecoder().decode(heartbeatChunk?.value)).toContain(": heartbeat");
    expect(authorize).toHaveBeenCalledWith({
      authorization: { authenticated: false, emailVerified: false, roles: [] },
      cursor: "event-42",
    });
    expect(formatSseConnectedEvent(undefined)).toContain("retry: 5000");
  });

  it("generates deterministic OpenAPI for versioned routes", async () => {
    const first = await createOpenApiDocument();
    const second = await createOpenApiDocument();

    expect(first).toBe(second);
    expect(JSON.parse(first)).toMatchObject({
      openapi: "3.0.3",
      paths: {
        "/v1/system/commands/sample": { post: { operationId: "executeSampleCommand" } },
        "/v1/events": { get: { operationId: "subscribeToEvents" } },
      },
    });
  });
});
