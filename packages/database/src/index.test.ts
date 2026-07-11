import { describe, expect, expectTypeOf, it } from "vitest";
import { createInfrastructureReadinessCheck, type DatabaseLifecycle } from "./index.js";

describe("database adapter boundary", () => {
  it("requires an explicit connection lifecycle", () => {
    expectTypeOf<DatabaseLifecycle>().toHaveProperty("connect");
    expectTypeOf<DatabaseLifecycle>().toHaveProperty("disconnect");
  });

  it("fails closed when required infrastructure is unreachable", async () => {
    const check = createInfrastructureReadinessCheck({
      databaseUrl: "postgres://127.0.0.1:1/unavailable",
      redisUrl: "redis://127.0.0.1:1",
      timeoutMilliseconds: 50,
    });

    await expect(check()).resolves.toEqual({ postgres: false, redis: false });
  });
});
