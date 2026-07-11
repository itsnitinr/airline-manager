import { describe, expect, it } from "vitest";
import { workerHealth } from "./index.js";

describe("worker entry point", () => {
  it("reports readiness without owning authoritative state", () => {
    expect(workerHealth()).toEqual({ service: "worker", status: "ok" });
  });
});
