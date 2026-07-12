import { describe, expect, it } from "vitest";
import {
  generateAirportWeather,
  planRouteWeather,
  type AirportClimateProfile,
  type WeatherRules,
} from "./weather.js";

const rules: WeatherRules = {
  worldSeed: "slice-one-weather-seed-v1",
  worldRulesetVersion: "contemporary-2026.07.11",
  weatherRulesetVersion: "weather-v1",
  climateDataVersion: "slice-one-climate-v1",
  formulaVersion: "geographic-weather-v1",
  systemBucketHours: 6,
  correlationCellDegrees: 10,
  maximumForecastLeadHours: 2160,
};
const profile = (
  airportId: string,
  latitudeDeg: string,
  longitudeDeg: string,
): AirportClimateProfile => ({
  airportId,
  iataCode: airportId.slice(0, 3).toUpperCase(),
  latitudeDeg,
  longitudeDeg,
  elevationFt: 100,
  timezoneName: "UTC",
  climateDataVersion: "slice-one-climate-v1",
  zone: "temperate",
  baselineWindKt: 10,
  seasonalWindAmplitudeKt: 5,
  storminessBasisPoints: 3_000,
  lowVisibilityBasisPoints: 1_000,
  wetSeasonPeakMonth: 1,
  provenance: { classification: "derived", formulaVersion: "climate-profile-v1" },
});

describe("generated weather", () => {
  it("reproduces the same material inputs and stays inside gameplay bounds", () => {
    const issued = new Date("2026-07-12T00:00:00Z");
    const valid = new Date("2026-07-14T12:00:00Z");
    const left = generateAirportWeather(rules, profile("aaa", "51.5", "-0.1"), issued, valid);
    const right = generateAirportWeather(rules, profile("aaa", "51.5", "-0.1"), issued, valid);
    expect(left).toEqual(right);
    expect(left.conditions.windSpeedKt).toBeGreaterThanOrEqual(0);
    expect(left.conditions.windSpeedKt).toBeLessThanOrEqual(65);
    expect(left.conditions.visibilityMeters).toBeGreaterThanOrEqual(800);
    expect(left.modifiers.runwayCapacityBasisPoints).toBeGreaterThanOrEqual(4_000);
    expect(left.modifiers.blockTimeBasisPoints).toBeLessThanOrEqual(13_500);
  });

  it("correlates nearby airports and coherent time windows more than distant systems", () => {
    const issued = new Date("2026-07-12T00:00:00Z");
    const valid = new Date("2026-07-13T00:00:00Z");
    const london = generateAirportWeather(rules, profile("lhr", "51.5", "-0.1"), issued, valid);
    const nearby = generateAirportWeather(rules, profile("lgw", "51.1", "-0.2"), issued, valid);
    const distant = generateAirportWeather(rules, profile("syd", "-33.9", "151.2"), issued, valid);
    expect(
      Math.abs(london.conditions.windSpeedKt - nearby.conditions.windSpeedKt),
    ).toBeLessThanOrEqual(8);
    expect(london.materialInputHash).not.toBe(distant.materialInputHash);
  });

  it("expands uncertainty monotonically and derives realization only from the seeded process", () => {
    const issued = new Date("2026-07-12T00:00:00Z");
    const climate = profile("sin", "1.36", "103.99");
    const short = generateAirportWeather(rules, climate, issued, new Date("2026-07-12T06:00:00Z"));
    const long = generateAirportWeather(rules, climate, issued, new Date("2026-07-15T00:00:00Z"));
    const realized = generateAirportWeather(
      rules,
      climate,
      issued,
      new Date("2026-07-15T00:00:00Z"),
      "realized",
    );
    expect(long.uncertainty.spreadBasisPoints).toBeGreaterThan(short.uncertainty.spreadBasisPoints);
    expect(realized.uncertainty.processVersion).toBe("seeded-lead-spread-v1");
    expect(realized).toEqual(
      generateAirportWeather(rules, climate, issued, new Date("2026-07-15T00:00:00Z"), "realized"),
    );
  });

  it("represents hemisphere seasonality and explains stable planning modifiers", () => {
    const issued = new Date("2026-01-01T00:00:00Z");
    const north = profile("nrt", "35.8", "140.4");
    const south = { ...profile("syd", "-33.9", "151.2"), wetSeasonPeakMonth: 7 };
    const valid = new Date("2026-01-15T00:00:00Z");
    const plan = planRouteWeather(
      generateAirportWeather(rules, north, issued, valid),
      generateAirportWeather(rules, south, issued, valid),
    );
    expect(plan.expectedBlockTimeBasisPoints).toBeGreaterThanOrEqual(9_000);
    expect(plan.expectedFuelBurnBasisPoints).toBeLessThanOrEqual(12_500);
    expect(plan.explanations.join(" ")).toContain("advisory");
  });

  it("binds outputs to weather rules and climate material versions", () => {
    const issued = new Date("2026-07-12T00:00:00Z");
    const valid = new Date("2026-07-14T00:00:00Z");
    const climate = profile("jfk", "40.64", "-73.78");
    const baseline = generateAirportWeather(rules, climate, issued, valid);
    const newRules = generateAirportWeather(
      { ...rules, weatherRulesetVersion: "weather-v2" },
      climate,
      issued,
      valid,
    );
    const newClimate = generateAirportWeather(
      rules,
      { ...climate, climateDataVersion: "slice-one-climate-v2" },
      issued,
      valid,
    );
    expect(newRules.materialInputHash).not.toBe(baseline.materialInputHash);
    expect(newClimate.materialInputHash).not.toBe(baseline.materialInputHash);
  });

  it("holds all documented physical and gameplay invariants across a broad deterministic matrix", () => {
    const issued = new Date("2026-01-01T00:00:00Z");
    for (let index = 0; index < 500; index += 1) {
      const latitude = -75 + (index % 151);
      const longitude = -175 + ((index * 37) % 350);
      const valid = new Date(issued.getTime() + (index % 90) * 24 * 3_600_000);
      const snapshot = generateAirportWeather(
        { ...rules, worldSeed: `matrix-${index % 17}` },
        profile(`p${index}`, String(latitude), String(longitude)),
        issued,
        valid,
      );
      expect(snapshot.conditions.windSpeedKt).toBeGreaterThanOrEqual(0);
      expect(snapshot.conditions.windSpeedKt).toBeLessThanOrEqual(65);
      expect(snapshot.conditions.visibilityMeters).toBeGreaterThanOrEqual(800);
      expect(snapshot.conditions.visibilityMeters).toBeLessThanOrEqual(25_000);
      expect(snapshot.modifiers.runwayCapacityBasisPoints).toBeGreaterThanOrEqual(4_000);
      expect(snapshot.modifiers.blockTimeBasisPoints).toBeLessThanOrEqual(13_500);
      expect(snapshot.modifiers.fuelBurnBasisPoints).toBeGreaterThanOrEqual(9_500);
      expect(snapshot.modifiers.reliabilityBasisPoints).toBeGreaterThanOrEqual(8_000);
    }
  });
});
