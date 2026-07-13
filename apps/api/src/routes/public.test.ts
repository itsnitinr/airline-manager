import { GetCurrentPublishedCatalogHandler } from "@airline-manager/application";
import type { CatalogRepository } from "@airline-manager/domain";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "../app.js";

const apps = new Set<FastifyInstance>();

afterEach(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  apps.clear();
});

function currentCatalog() {
  const repository: CatalogRepository = {
    async findCurrentPublishedCatalog() {
      return {
        releaseVersion: "release-v1",
        worldRulesetVersion: "world-v1",
        airports: [],
        aircraftVariants: [],
      };
    },
    async findPublishedCatalogByWorldRuleset() {
      return undefined;
    },
    async findAirportByIataCode() {
      return undefined;
    },
    async listAircraftVariants() {
      return [];
    },
  };
  return new GetCurrentPublishedCatalogHandler(repository);
}

describe("public onboarding discovery routes", () => {
  it("returns only provider availability and the current published catalog anonymously", async () => {
    const app = createApiServer({
      logger: false,
      googleSignInAvailable: true,
      currentCatalog: currentCatalog(),
    });
    apps.add(app);

    const [config, catalog] = await Promise.all([
      app.inject({ method: "GET", url: "/v1/public/config" }),
      app.inject({ method: "GET", url: "/v1/catalog/current" }),
    ]);
    expect(config.statusCode).toBe(200);
    expect(config.json()).toEqual({ googleSignInAvailable: true });
    expect(config.body).not.toMatch(/client|secret|oauth/i);
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toEqual({
      releaseVersion: "release-v1",
      worldRulesetVersion: "world-v1",
      airports: [],
      aircraftVariants: [],
    });
  });

  it("returns a bounded unavailable response when no published catalog is configured", async () => {
    const app = createApiServer({ logger: false });
    apps.add(app);
    const response = await app.inject({ method: "GET", url: "/v1/catalog/current" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "catalog_unavailable" } });
  });
});
