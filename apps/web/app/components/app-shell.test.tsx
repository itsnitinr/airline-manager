import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

vi.mock("../map/airport-map", () => ({
  AirportMap: ({ label }: { label: string }) => <div aria-label={label}>map</div>,
}));
vi.mock("./session-actions", () => ({
  BrowserNotificationButton: () => <button>Enable browser alerts</button>,
  SignOutButton: () => <button>Sign out</button>,
}));

const career = {
  careerId: "career",
  airlineId: "airline",
  name: "Northline Air",
  normalizedAirlineName: "northline air",
  brand: { primaryColor: "#32A7C7", secondaryColor: "#162E3A", logoMark: "NA" },
  careerStatus: "active",
  airlineStatus: "active",
  homeJurisdiction: "GB",
  reportingCurrency: "GBP",
  catalogReleaseVersion: "catalog",
  worldRulesetVersion: "world",
  foundingBalanceVersion: "balance",
  principalBase: {
    airportId: "lhr",
    iataCode: "LHR",
    name: "London Heathrow Airport",
    countryCode: "GB",
    stationServiceModel: "outsourced",
  },
  cashMinor: "100000",
  equityMinor: "100000",
  loanLiabilityMinor: "0",
  nextStep: "select_founder_aircraft",
  nextStepGuidance: "Choose aircraft.",
} as const;
const aircraft = {
  id: "aircraft",
  serialNumber: "serial",
  airlineId: "airline",
  leaseId: "lease",
  catalogReleaseId: "catalog",
  catalogReleaseVersion: "catalog",
  variantId: "variant",
  variantCode: "atr",
  manufacturer: "ATR",
  model: "72-600",
  owner: { lessorId: "lessor", name: "Lessor" },
  operatorAirlineId: "airline",
  currentAirportId: "lhr",
  plannedAirportId: "lhr",
  deliveryState: "delivered",
  deliveryTargetAt: "2026-07-13T12:00:00Z",
  deliveredAt: "2026-07-13T12:00:00Z",
  manufacturedAt: "2026-07-13T12:00:00Z",
  chronologicalAgeSeconds: "0",
  accumulatedHoursMinutes: "0",
  accumulatedCycles: "0",
  conditionBasisPoints: 10000,
  dispatchReliabilityBasisPoints: 10000,
  version: "1",
  cabin: {
    configurationKind: "physical_cabin",
    economySeats: 72,
    premiumEconomySeats: 0,
    businessSeats: 0,
    firstSeats: 0,
    bookingClassesConfigured: false,
  },
  restrictions: { sale: true, collateral: true, cashExtraction: true },
} as const;

describe("responsive shell boundaries", () => {
  it("shows real airline state while future planners remain unavailable", () => {
    render(
      <AppShell
        career={career}
        fleet={[aircraft]}
        airports={[
          {
            id: "lhr",
            iataCode: "LHR",
            name: "London Heathrow Airport",
            latitudeDeg: "51.47",
            longitudeDeg: "-0.45",
          },
        ]}
        userEmail="pilot@example.test"
      />,
    );
    expect(screen.getByText("Founder aircraft delivered")).toBeTruthy();
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(1);
    expect(screen.getByRole("navigation", { name: "Mobile monitoring" })).toBeTruthy();
  });
});
