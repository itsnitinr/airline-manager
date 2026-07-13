import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkforceWorkspace } from "./workforce-workspace";

describe("workforce qualification and shortage display", () => {
  it("names pilot type ratings and links affected flights back to the timetable", () => {
    render(
      <WorkforceWorkspace
        airlineId="airline"
        initialPools={[
          {
            id: "pool",
            airlineId: "airline",
            baseAirportId: "jfk",
            baseIataCode: "JFK",
            role: "pilot",
            qualification: { code: "variant:atr-72-600", aircraftVariantId: "variant" },
            activeCapacity: 1,
            pendingCapacity: 0,
            wagePerIntervalMinor: "100000",
            reportingCurrency: "USD",
            wageCheckpointAt: "2026-07-13T00:00:00Z",
            nextWageDueAt: "2026-07-14T00:00:00Z",
            version: "1",
          },
        ]}
        recommendations={[]}
        initialForecast={
          {
            generatedAt: "2026-07-13T00:00:00Z",
            through: "2026-07-20T00:00:00Z",
            feasible: false,
            explanations: ["Aggregate duty recovery applies."],
            shortages: [
              {
                flightId: "flight",
                flightNumber: "AM101",
                role: "pilot",
                qualificationCode: "variant:atr-72-600",
                baseAirportId: "jfk",
                baseIataCode: "JFK",
                windowStartsAt: "2026-07-14T12:00:00Z",
                windowEndsAt: "2026-07-14T16:00:00Z",
                requiredCapacity: 2,
                availableCapacity: 1,
                shortfall: 1,
                correction: "Hire or train one pilot capacity.",
              },
            ],
          } as never
        }
        fleet={
          [
            {
              id: "aircraft",
              variantId: "variant",
              variantCode: "atr-72-600",
              manufacturer: "ATR",
              model: "72-600",
            },
          ] as never
        }
      />,
    );

    expect(screen.getAllByText("variant:atr-72-600").length).toBeGreaterThan(0);
    expect(screen.getByText("Type rating required for assigned aircraft")).toBeVisible();
    expect(screen.getByText(/AM101 · pilot/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Review affected route and timetable" }),
    ).toHaveAttribute("href", "/app?view=network");
    expect(screen.getByText("Staffing changes require desktop")).toBeInTheDocument();
  });
});
