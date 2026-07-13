import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./lib/api";

describe("navigation safety", () => {
  it("preserves local return paths and rejects protocol-relative redirects", () => {
    expect(safeReturnPath("/onboarding")).toBe("/onboarding");
    expect(safeReturnPath("//outside.example", "/app")).toBe("/app");
  });
});
