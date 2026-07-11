import { describe, expectTypeOf, it } from "vitest";
import type { DatabaseLifecycle } from "./index.js";

describe("database adapter boundary", () => {
  it("requires an explicit connection lifecycle", () => {
    expectTypeOf<DatabaseLifecycle>().toHaveProperty("connect");
    expectTypeOf<DatabaseLifecycle>().toHaveProperty("disconnect");
  });
});
