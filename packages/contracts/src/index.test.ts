import { describe, expect, it } from "vitest";
import { createHealthResponse, createReadinessResponse } from "./index.js";

describe("health contract", () => {
  it("creates a stable public response", () => {
    expect(createHealthResponse("api")).toEqual({ service: "api", status: "ok" });
  });

  it("reports dependency-aware readiness without exposing connection details", () => {
    expect(createReadinessResponse("worker", { postgres: true, redis: false })).toEqual({
      service: "worker",
      status: "not_ready",
      dependencies: { postgres: "up", redis: "down" },
    });
  });
});
