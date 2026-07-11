import { describe, expect, it } from "vitest";
import { readOptionalInteger, readOptionalString } from "./index.js";

describe("configuration readers", () => {
  it("treats empty values as absent", () => {
    expect(readOptionalString("VALUE", { VALUE: "  " })).toBeUndefined();
  });

  it("parses integer values strictly", () => {
    expect(readOptionalInteger("PORT", { PORT: "3001" })).toBe(3001);
    expect(() => readOptionalInteger("PORT", { PORT: "3001x" })).toThrow(
      "PORT must be an integer.",
    );
  });
});
