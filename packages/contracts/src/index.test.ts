import { describe, expect, it } from "vitest";
import { createHealthResponse } from "./index.js";

describe("health contract", () => {
  it("creates a stable public response", () => {
    expect(createHealthResponse("api")).toEqual({ service: "api", status: "ok" });
  });
});
