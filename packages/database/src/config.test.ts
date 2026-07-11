import { describe, expect, it } from "vitest";
import { readDatabasePoolOptions, toPgPoolConfig } from "./config.js";

describe("database pool configuration", () => {
  it.each([
    ["api", 20],
    ["worker", 10],
    ["test", 5],
    ["migration", 1],
  ] as const)("provides bounded %s pool defaults", (role, maximumConnections) => {
    const options = readDatabasePoolOptions(role, {
      DATABASE_URL: "postgresql://example.invalid/database",
    });
    expect(options.maximumConnections).toBe(maximumConnections);
    expect(options.applicationName).toBe(`airline-manager-${role}`);
    expect(toPgPoolConfig(options)).toMatchObject({
      max: maximumConnections,
      options: "-c timezone=UTC",
    });
  });

  it("uses purpose-specific test and migration URLs", () => {
    const environment = {
      DATABASE_URL: "postgresql://runtime",
      TEST_DATABASE_URL: "postgresql://test",
      MIGRATION_DATABASE_URL: "postgresql://migration",
    };
    expect(readDatabasePoolOptions("test", environment).connectionString).toBe("postgresql://test");
    expect(readDatabasePoolOptions("migration", environment).connectionString).toBe(
      "postgresql://migration",
    );
  });

  it("rejects invalid pool bounds", () => {
    expect(() =>
      readDatabasePoolOptions("api", {
        DATABASE_URL: "postgresql://runtime",
        DATABASE_POOL_MAX: "0",
      }),
    ).toThrow("DATABASE_POOL_MAX must be a positive integer.");
  });
});
