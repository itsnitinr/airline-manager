import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApiServer } from "./index.js";

const servers = new Set<ReturnType<typeof createApiServer>>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(async (server) => {
      server.close();
      await once(server, "close");
    }),
  );
  servers.clear();
});

describe("API health entry point", () => {
  it("returns a public health response", async () => {
    const server = createApiServer().listen(0, "127.0.0.1");
    servers.add(server);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ service: "api", status: "ok" });
  });
});
