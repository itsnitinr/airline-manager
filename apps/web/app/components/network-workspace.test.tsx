import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { planningApi } from "../lib/planning-api";
import { NetworkWorkspace } from "./network-workspace";

vi.mock("../map/airport-map", () => ({
  AirportMap: ({ label }: { label: string }) => <div aria-label={label}>map</div>,
}));
vi.mock("../lib/planning-api", async () => {
  const actual = await vi.importActual<typeof import("../lib/planning-api")>("../lib/planning-api");
  return {
    ...actual,
    planningApi: {
      ...actual.planningApi,
      researchRoute: vi.fn(),
      createRoute: vi.fn(),
      listRoutes: vi.fn(),
      routePlanning: vi.fn(),
      updatePricing: vi.fn(),
      activateTimetable: vi.fn(),
      routeWeather: vi.fn(),
    },
  };
});

const airports = [
  {
    id: "jfk",
    iataCode: "JFK",
    name: "John F. Kennedy",
    latitudeDeg: "40.6",
    longitudeDeg: "-73.7",
  },
  { id: "bos", iataCode: "BOS", name: "Boston Logan", latitudeDeg: "42.3", longitudeDeg: "-71.0" },
] as const;
const fleet = [
  {
    id: "aircraft",
    manufacturer: "ATR",
    model: "72-600",
    deliveryState: "delivered",
  },
] as unknown as Parameters<typeof NetworkWorkspace>[0]["fleet"];
const research = {
  valid: false,
  issues: [
    {
      code: "range_exceeded",
      field: "aircraftId",
      message: "Route exceeds range.",
      suggestedCorrection: "Select an aircraft with more range.",
    },
    {
      code: "runway_too_short",
      field: "destinationIataCode",
      message: "Runway is too short.",
      suggestedCorrection: "Choose a runway-compatible aircraft.",
    },
    {
      code: "curfew_conflict",
      field: "legs",
      message: "Arrival is inside curfew.",
      suggestedCorrection: "Move arrival outside curfew.",
    },
  ],
  forecast: {
    distanceNm: 2500,
    plannedBlockMinutes: 390,
    minimumTurnaroundMinutes: 50,
    provisionalOperatingCostMinor: "900000",
    provisionalDailyDemand: "68.2",
    currency: "USD",
    expectedDailyRevenueRangeMinor: ["1100000", "1500000"],
    expectedDailyProfitRangeMinor: ["200000", "600000"],
    economicsEffectiveAt: "2026-07-13T00:00:00Z",
    economicsAssumptions: ["One daily departure."],
    operatingCostFormulaVersion: "schedule-cost-v1",
    economicsFormulaVersion: "schedule-economics-v1",
    blockTimeFormulaVersion: "schedule-block-v1",
    outsourcedService: true,
  },
  market: {
    marketId: "market",
    forecast: {
      segments: [
        {
          segment: "business",
          dailyDemand: "12.5",
          sensitivity: { explanation: "Schedule sensitive." },
        },
      ],
    },
    competition: {
      asOf: "2026-07-13T00:00:00Z",
      bucket: "day",
      capacitySeats: "100",
      farePressureBasisPoints: 1200,
      scheduleQualityBasisPoints: 7000,
      frequencyPerWeek: 14,
      serviceQualityBasisPoints: 6500,
      formulaVersion: "competition-v1",
      classification: "simulated_aggregate_market_pressure",
      explanation: "Aggregate simulated competition.",
    },
    recommendedPricing: {
      posture: "balanced",
      effectiveFrom: "2026-07-14T00:00:00Z",
      baseFareMinor: "22000",
      minimumFareMinor: "14000",
      maximumFareMinor: "42000",
      loadFactorTargetBasisPoints: 8200,
      revenueTargetMinor: "1200000",
      currency: "USD",
    },
    explanation: [],
  },
  explanations: [],
} as unknown as Awaited<ReturnType<typeof planningApi.researchRoute>>;

describe("route research and capability boundaries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders every backend constraint with a navigable recovery path", async () => {
    vi.mocked(planningApi.researchRoute).mockResolvedValue(research);
    const user = userEvent.setup();
    render(
      <NetworkWorkspace
        airlineId="airline"
        baseAirportId="jfk"
        reportingCurrency="USD"
        airports={airports}
        fleet={fleet}
        initialRoutes={[]}
        initialPlanning={null}
        initialWeather={null}
        initialPricingStrategies={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Research direct route" }));
    await waitFor(() => expect(screen.getByText("Route exceeds range.")).toBeVisible());
    expect(screen.getByText("Runway is too short.")).toBeVisible();
    expect(screen.getByText("Arrival is inside curfew.")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Select an aircraft with more range." }),
    ).toHaveAttribute("href", "/app?view=fleet");
    expect(screen.getByText(/Expected profit/)).toBeVisible();
  });

  it("preserves prospective pricing input on failure and exposes the mobile rotation handoff", async () => {
    vi.mocked(planningApi.researchRoute).mockResolvedValue(research);
    vi.mocked(planningApi.updatePricing).mockRejectedValue(new Error("pricing unavailable"));
    const user = userEvent.setup();
    render(
      <NetworkWorkspace
        airlineId="airline"
        baseAirportId="jfk"
        reportingCurrency="USD"
        airports={airports}
        fleet={fleet}
        initialRoutes={[]}
        initialPlanning={
          {
            route: {
              airlineId: "airline",
              createdAt: "2026-07-13T00:00:00Z",
              destination: { id: "bos", iataCode: "BOS" },
              distanceNm: 2500,
              id: "route",
              marketId: "market",
              origin: { id: "jfk", iataCode: "JFK" },
              routeNumber: 20,
              rulesetVersion: "scheduling-v1",
              status: "researched",
            },
            forecast: research.forecast,
          } as Parameters<typeof NetworkWorkspace>[0]["initialPlanning"]
        }
        initialWeather={null}
        initialPricingStrategies={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Research direct route" }));
    const effectiveInput = await screen.findByLabelText("Effective from");
    const prospectiveValue = (effectiveInput as HTMLInputElement).value;
    expect(prospectiveValue).toMatch(/^\d{4}-\d{2}-\d{2}T00:00$/);
    await user.click(screen.getByRole("button", { name: "Save prospective strategy" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The planning service could not complete the request. Your entered values remain available.",
      ),
    );
    expect(effectiveInput).toHaveValue(prospectiveValue);
    expect(screen.getByText("Rotation editing requires desktop")).toBeInTheDocument();
  });
});
