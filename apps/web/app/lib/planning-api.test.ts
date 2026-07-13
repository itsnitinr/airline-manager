import { describe, expect, it } from "vitest";
import type { ListWorkforcePoolsResponse } from "@airline-manager/contracts";
import { asWorkforcePools } from "./planning-api";

describe("planning API adapters", () => {
  it("keeps only complete owner-scoped workforce pool records", () => {
    const pools = asWorkforcePools([
      {
        id: "pool",
        airlineId: "airline",
        baseAirportId: "base",
        baseIataCode: "JFK",
        role: "pilot",
        qualification: { code: "variant:atr-72-600", aircraftVariantId: "variant" },
        activeCapacity: 2,
        pendingCapacity: 1,
        wagePerIntervalMinor: "50000",
        reportingCurrency: "USD",
        wageCheckpointAt: "2026-07-13T00:00:00Z",
        nextWageDueAt: "2026-07-14T00:00:00Z",
        version: "1",
      },
      { id: "partial", role: "pilot" },
    ] as unknown as ListWorkforcePoolsResponse);

    expect(pools).toHaveLength(1);
    expect(pools[0]?.qualification.code).toBe("variant:atr-72-600");
  });
});
