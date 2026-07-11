import { describe, expect, it } from "vitest";
import { readCurrentTime } from "./index.js";

describe("domain time boundary", () => {
  it("uses injected time", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(readCurrentTime({ now: () => now })).toBe(now);
  });
});
