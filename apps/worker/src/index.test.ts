import { once } from "node:events";
import type { AddressInfo } from "node:net";
import {
  anonymousAuthorizationContext,
  createApplicationServices,
} from "@airline-manager/application";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkerHealthServer, executeWorkerSampleCommand, workerHealth } from "./index.js";

const servers = new Set<ReturnType<typeof createWorkerHealthServer>>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(async (server) => {
      server.close();
      await once(server, "close");
    }),
  );
  servers.clear();
});

describe("worker entry point", () => {
  it("reports readiness without owning authoritative state", () => {
    expect(workerHealth()).toEqual({ service: "worker", status: "ok" });
  });

  it("exposes dependency-aware readiness for container orchestration", async () => {
    const server = createWorkerHealthServer(async () => ({ postgres: false, redis: true })).listen(
      0,
      "127.0.0.1",
    );
    servers.add(server);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/ready`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      service: "worker",
      status: "not_ready",
      dependencies: { postgres: "down", redis: "up" },
      runtime: { draining: false, ready: true, active: 0, lag: {} },
    });
  });

  it("invokes the shared application command without starting Fastify", async () => {
    const services = createApplicationServices({ now: () => new Date("2026-07-11T12:00:00Z") });

    await expect(
      executeWorkerSampleCommand(
        services,
        { message: "direct worker call" },
        {
          requestId: "worker-request",
          commandId: "worker-command",
          transactionId: "worker-transaction",
          idempotencyKey: "worker-idempotency",
          authorization: anonymousAuthorizationContext,
        },
      ),
    ).resolves.toMatchObject({
      message: "direct worker call",
      commandId: "worker-command",
      transactionId: "worker-transaction",
    });
  });
});
