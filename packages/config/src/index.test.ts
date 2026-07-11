import { describe, expect, it } from "vitest";
import { readOptionalInteger, readOptionalString, readRequiredString } from "./index.js";

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

  it("requires non-empty values when requested", () => {
    expect(readRequiredString("URL", { URL: "postgres://example" })).toBe("postgres://example");
    expect(() => readRequiredString("URL", { URL: "" })).toThrow("URL is required.");
  });
});
