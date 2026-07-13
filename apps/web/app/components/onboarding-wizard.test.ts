import { describe, expect, it } from "vitest";
import { founderGuidance } from "./onboarding-wizard";

describe("founder package comparison guidance", () => {
  it("explains practical use and operating implications without changing economics", () => {
    expect(founderGuidance("turboprop")).toEqual({
      staffing: "Small regional operating footprint and specialist turboprop crews.",
      recommendedUse: "Thin regional links and shorter runways",
    });
    expect(founderGuidance("regional_jet").recommendedUse).toContain("lower capacity risk");
    expect(founderGuidance("narrowbody").staffing).toContain("recurring cash commitments");
  });
});
