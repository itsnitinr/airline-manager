import { describe, expect, it } from "vitest";
import type { CatalogRepository } from "@airline-manager/domain";
import { anonymousAuthorizationContext } from "./index.js";
import { GetCurrentPublishedCatalogHandler, GetPublishedCatalogHandler } from "./catalog.js";

describe("catalog query service", () => {
  it("delegates through the read-only domain port", async () => {
    const repository: CatalogRepository = {
      async findCurrentPublishedCatalog() {
        return {
          releaseVersion: "current-release",
          worldRulesetVersion: "current-world",
          airports: [],
          aircraftVariants: [],
        };
      },
      async findPublishedCatalogByWorldRuleset(version) {
        return {
          releaseVersion: "release",
          worldRulesetVersion: version,
          airports: [],
          aircraftVariants: [],
        };
      },
      async findAirportByIataCode() {
        return undefined;
      },
      async listAircraftVariants() {
        return [];
      },
    };
    const result = await new GetPublishedCatalogHandler(repository).execute(
      { worldRulesetVersion: "world" },
      { requestId: "request", authorization: anonymousAuthorizationContext },
    );
    expect(result).toMatchObject({ releaseVersion: "release", worldRulesetVersion: "world" });
    await expect(
      new GetCurrentPublishedCatalogHandler(repository).execute(
        {},
        { requestId: "request", authorization: anonymousAuthorizationContext },
      ),
    ).resolves.toMatchObject({
      releaseVersion: "current-release",
      worldRulesetVersion: "current-world",
    });
  });
});
