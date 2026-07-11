import { describe, expect, it } from "vitest";
import { readAircraftFixture, readAirportFixture } from "./fixtures.js";
import { validateAirportCandidate } from "./validation.js";

describe("offline reference fixtures", () => {
  it("contains the deterministic globally distributed slice-one data", async () => {
    const [airports, aircraft] = await Promise.all([readAirportFixture(), readAircraftFixture()]);
    expect(airports.airports).toHaveLength(250);
    expect(airports.distribution).toEqual({ AF: 25, AS: 60, EU: 60, NA: 60, OC: 20, SA: 25 });
    expect(airports.ourairports).toMatchObject({
      source_version: "2026-07-11",
      airports_sha256: "7034202901ff8a2e9a3bde255a2a6d3348ae5dd6e984767fc8d69a4c0d7b4f80",
      runways_sha256: "74af303465d0fa21dd4e3233c2bb18f79f241896fe541a9d510bc7a9906c46b0",
    });
    expect(airports.iana.version).toBe("2026b");
    expect(aircraft.variants.map(({ category }) => category)).toEqual([
      "turboprop",
      "regional_jet",
      "narrow_body",
      "narrow_body",
    ]);
    expect(aircraft.variants.map(({ code }) => code)).toEqual([
      "atr-72-600",
      "embraer-e175",
      "airbus-a320neo",
      "boeing-737-8",
    ]);
  });

  it("returns actionable validation failures without promoting incomplete data", async () => {
    const fixture = await readAirportFixture();
    const invalid = {
      source_record_id: "invalid",
      ident: "bad",
      iata_code: "12",
      icao_code: "x",
      name: "",
      municipality: "",
      country_code: "USA",
      region_code: "",
      world_region: "NA",
      latitude_deg: 120,
      longitude_deg: -181,
      timezone_name: "Mars/Olympus",
      longest_runway_ft: 1200,
      scheduled_service: false,
      commercial_relevance: "small_airport",
    };
    const results = validateAirportCandidate(
      invalid,
      new Set(fixture.timezones.map(({ name }) => name)),
    );
    expect(results).toHaveLength(6);
    expect(results.every(({ passed }) => !passed)).toBe(true);
    expect(results.map(({ ruleCode }) => ruleCode)).toEqual([
      "coordinates_valid",
      "timezone_valid",
      "identifiers_valid",
      "runway_sufficient",
      "commercial_relevance",
      "source_complete",
    ]);
    expect(results.every(({ message }) => message.length > 20)).toBe(true);
  });
});
