import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

vi.mock("./session-actions", () => ({
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

describe("planning shell boundaries", () => {
  it("exposes planning and ticket-21 destinations without player administration", () => {
    render(
      <AppShell
        career={career}
        fleet={[aircraft]}
        userEmail="pilot@example.test"
        activeView="fleet"
      >
        <section aria-label="Authoritative fleet workspace">Fleet detail</section>
      </AppShell>,
    );

    const rail = screen.getByRole("complementary", { name: "Airline navigation rail" });
    expect(within(rail).getByRole("link", { name: "Fleet" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(rail).getByRole("link", { name: "Fuel" })).toHaveAttribute(
      "href",
      "/app?view=fuel",
    );
    expect(within(rail).getByRole("link", { name: "Operations" })).toHaveAttribute(
      "href",
      "/app?view=operations",
    );
    expect(within(rail).getByRole("link", { name: "Finance" })).toHaveAttribute(
      "href",
      "/app?view=finance",
    );
    expect(within(rail).getByRole("link", { name: "Alerts" })).toHaveAttribute(
      "href",
      "/app?view=notifications",
    );
    expect(within(rail).queryByText(/administration/i)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Authoritative fleet workspace" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Mobile planning navigation" })).toBeTruthy();
  });
});
