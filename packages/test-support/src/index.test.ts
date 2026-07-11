import { describe, expect, it } from "vitest";
import { createFixedClock } from "./index.js";

describe("fixed clock", () => {
  it("returns a deterministic instant", () => {
    const instant = new Date("2026-01-01T00:00:00.000Z");
    expect(createFixedClock(instant).now()).toBe(instant);
  });
});
