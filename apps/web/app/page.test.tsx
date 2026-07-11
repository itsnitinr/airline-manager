import { describe, expect, it } from "vitest";
import HomePage from "./page";

describe("HomePage", () => {
  it("provides the application shell", () => {
    expect(HomePage().type).toBe("main");
  });
});
