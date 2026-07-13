import type {
  GetAirlineCareerSummaryResponse,
  ListFleetResponse,
} from "@airline-manager/contracts";
import { notFound } from "next/navigation";
import { AppShell } from "../../components/app-shell";

const career = {
  careerId: "visual-career",
  airlineId: "visual-airline",
  name: "Meridian Coast",
  normalizedAirlineName: "meridian coast",
  brand: { primaryColor: "#58B7D3", secondaryColor: "#132A35", logoMark: "MC" },
  careerStatus: "active",
  airlineStatus: "active",
  homeJurisdiction: "US",
  reportingCurrency: "USD",
  catalogReleaseVersion: "catalog-2026-07",
  worldRulesetVersion: "world-v1",
  foundingBalanceVersion: "founding-v1",
  principalBase: {
    airportId: "catalog-jfk",
    iataCode: "JFK",
    name: "John F. Kennedy International Airport",
    countryCode: "US",
    stationServiceModel: "outsourced",
  },
  cashMinor: "2450000000",
  equityMinor: "2500000000",
  loanLiabilityMinor: "0",
  nextStep: "select_founder_aircraft",
  nextStepGuidance: "Monitor founder-aircraft delivery before opening the network plan.",
} as GetAirlineCareerSummaryResponse;

const aircraft = {
  id: "visual-aircraft",
  serialNumber: "TEST-ATR-001",
  airlineId: "visual-airline",
  leaseId: "visual-lease",
  catalogReleaseId: "visual-catalog",
  catalogReleaseVersion: "catalog-2026-07",
  variantId: "visual-atr",
  variantCode: "atr-72-600",
  manufacturer: "ATR",
  model: "72-600",
  owner: { lessorId: "visual-lessor", name: "Founder Lease Partner" },
  operatorAirlineId: "visual-airline",
  currentAirportId: "catalog-jfk",
  plannedAirportId: "catalog-jfk",
  deliveryState: "delivered",
  deliveryTargetAt: "2026-07-13T12:00:00Z",
  deliveredAt: "2026-07-13T12:00:00Z",
  manufacturedAt: "2026-07-13T12:00:00Z",
  chronologicalAgeSeconds: "0",
  accumulatedHoursMinutes: "0",
  accumulatedCycles: 0,
  conditionBasisPoints: 10000,
  dispatchReliabilityBasisPoints: 10000,
  version: 1,
  cabin: {
    configurationKind: "physical_cabin",
    economySeats: 72,
    premiumEconomySeats: 0,
    businessSeats: 0,
    firstSeats: 0,
    bookingClassesConfigured: false,
  },
  restrictions: { sale: true, collateral: true, cashExtraction: true },
} as unknown as ListFleetResponse[number];

const airports = [
  {
    id: "catalog-jfk",
    iataCode: "JFK",
    name: "John F. Kennedy International Airport",
    latitudeDeg: "40.6413",
    longitudeDeg: "-73.7781",
  },
  {
    id: "catalog-lhr",
    iataCode: "LHR",
    name: "London Heathrow Airport",
    latitudeDeg: "51.4700",
    longitudeDeg: "-0.4543",
  },
  {
    id: "catalog-sin",
    iataCode: "SIN",
    name: "Singapore Changi Airport",
    latitudeDeg: "1.3644",
    longitudeDeg: "103.9915",
  },
] as const;

export default async function ShellTestHarness({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; map?: string }>;
}) {
  if (process.env.MAP_TEST_HARNESS !== "enabled") notFound();
  const query = await searchParams;
  const fleet: ListFleetResponse = [
    query.state === "pending"
      ? ({ ...aircraft, deliveryState: "pending", deliveredAt: null } as ListFleetResponse[number])
      : aircraft,
  ];
  return (
    <AppShell
      career={career}
      fleet={fleet}
      airports={airports}
      userEmail="dispatcher@example.test"
      {...(query.map === "degraded" ? { mapStyleUrl: "/__map-style-failure__.json" } : {})}
    />
  );
}
