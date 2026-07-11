import { describe, expect, it } from "vitest";
import { isRetryableTransactionError } from "./transactions.js";

describe("transaction retry classification", () => {
  it.each(["40001", "40P01"])("recognizes PostgreSQL error %s", (code) => {
    expect(isRetryableTransactionError({ code })).toBe(true);
  });

  it.each(["23505", "57014", undefined])("does not retry error %s", (code) => {
    expect(isRetryableTransactionError({ code })).toBe(false);
  });
});
