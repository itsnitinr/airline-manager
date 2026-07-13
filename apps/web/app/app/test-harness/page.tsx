import type {
  GetAirlineCareerSummaryResponse,
  ListFleetResponse,
} from "@airline-manager/contracts";
import type {
  FinanceOverview,
  FinanceStatements,
  FlightBoard,
  JournalPage,
  NotificationCenter,
  NotificationPreferences,
  OfflineFlightChanges,
} from "@airline-manager/domain";
import { notFound } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { FinanceWorkspace } from "../../components/finance-workspace";
import { NetworkWorkspace } from "../../components/network-workspace";
import { NotificationWorkspace } from "../../components/notification-workspace";
import { OperationsWorkspace } from "../../components/operations-workspace";

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

const flightBoard: FlightBoard = {
  asOf: "2026-07-13T12:00:00Z",
  from: "2026-07-12T12:00:00Z",
  to: "2026-07-20T12:00:00Z",
  truncated: false,
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      airlineId: career.airlineId,
      routeId: "33333333-3333-4333-8333-333333333333",
      aircraftId: aircraft.id,
      flightNumber: "MC 021",
      state: "suspended",
      version: "3",
      departureAt: "2026-07-14T12:00:00Z",
      scheduledArrivalAt: "2026-07-14T13:20:00Z",
      departureLocal: "2026-07-14 08:00",
      arrivalLocal: "2026-07-14 09:20",
      effectiveAt: "2026-07-13T11:00:00Z",
      origin: {
        id: airports[0].id,
        iataCode: airports[0].iataCode,
        name: airports[0].name,
        timeZone: "America/New_York",
        latitudeDeg: airports[0].latitudeDeg,
        longitudeDeg: airports[0].longitudeDeg,
      },
      destination: {
        id: airports[1].id,
        iataCode: airports[1].iataCode,
        name: airports[1].name,
        timeZone: "Europe/London",
        latitudeDeg: airports[1].latitudeDeg,
        longitudeDeg: airports[1].longitudeDeg,
      },
      aircraft: {
        serialNumber: aircraft.serialNumber,
        variant: aircraft.variantCode,
        currentAirportId: airports[0].id,
      },
      delayMinutes: 35,
      passengersBooked: "54",
      passengersCarried: null,
      bookedRevenueMinor: "320000",
      reportingCurrency: career.reportingCurrency,
      weatherImpact: {
        summary: "Generated forecast is frozen with the dated flight.",
        provenance: "dated_flights.forecast_snapshot",
      },
      alerts: [
        {
          kind: "fuel",
          severity: "critical",
          label: "Fuel suspension",
          explanation: "Available fuel is below dispatch requirement.",
          recoveryPath: "/app?view=fuel",
        },
      ],
    },
  ],
};

const flightChanges: OfflineFlightChanges = {
  asOf: flightBoard.asOf,
  since: flightBoard.from,
  through: flightBoard.asOf,
  total: 1,
  byState: { suspended: 1 },
  items: [
    {
      flightId: flightBoard.items[0]!.id,
      flightNumber: flightBoard.items[0]!.flightNumber,
      fromState: "scheduled",
      toState: "suspended",
      effectiveAt: "2026-07-13T11:00:00Z",
      explanation: "Dispatch fuel unavailable.",
    },
  ],
};

const financeOverview: FinanceOverview = {
  asOf: flightBoard.asOf,
  reportingCurrency: career.reportingCurrency,
  supportedTransactionCurrencies: ["USD"],
  cashMinor: "2450000000",
  upcomingObligationsMinor: "12500000",
  runwayDays: 1960,
  runwayHorizonDays: 30,
  runwayExplanation: "Ledger cash divided by scheduled obligations in the bounded horizon.",
  obligations: [
    {
      id: "88888888-8888-4888-8888-888888888888",
      kind: "operating_lease",
      dueAt: "2026-07-20T12:00:00Z",
      amountMinor: "12500000",
      currency: "USD",
      status: "scheduled",
      sourceId: aircraft.leaseId,
    },
  ],
  routeProfitability: [
    {
      routeId: flightBoard.items[0]!.routeId,
      originIataCode: "JFK",
      destinationIataCode: "LHR",
      realizedRevenueMinor: "18200000",
      realizedCostMinor: "14600000",
      operatingResultMinor: "3600000",
      settledFlights: 4,
    },
  ],
  fuel: {
    onHandKg: "20000",
    inventoryValueMinor: "1000000",
    weightedUnitCostNumerator: "1000000",
    weightedUnitCostDenominator: "20000",
  },
  recentResults: [],
};

const financeStatements: FinanceStatements = {
  period: { from: "2026-07-01T00:00:00Z", to: "2026-08-01T00:00:00Z" },
  asOf: flightBoard.asOf,
  reportingCurrency: "USD",
  basis: "posted_double_entry_ledger",
  profitAndLoss: {
    rows: [
      {
        group: "Revenue",
        accountCode: "4100",
        accountName: "Passenger revenue",
        amountMinor: "18200000",
      },
    ],
    netIncomeMinor: "3600000",
  },
  balanceSheet: {
    rows: [
      {
        group: "Assets",
        accountCode: "1000",
        accountName: "Cash",
        amountMinor: "2450000000",
      },
    ],
    assetsMinor: "2451000000",
    liabilitiesAndEquityMinor: "2447400000",
    currentEarningsMinor: "3600000",
  },
  cashFlow: {
    rows: [
      {
        group: "Operating",
        accountCode: "1000",
        accountName: "Cash",
        amountMinor: "3600000",
      },
    ],
    netCashChangeMinor: "3600000",
  },
  reconciliation: {
    journalsBalanced: true,
    trialBalanceDifferenceMinor: "0",
    balanceSheetDifferenceMinor: "0",
  },
};

const journals: JournalPage = {
  asOf: flightBoard.asOf,
  reportingCurrency: "USD",
  nextCursor: null,
  items: [
    {
      id: "99999999-9999-4999-8999-999999999999",
      sequence: "42",
      occurredAt: "2026-07-13T10:00:00Z",
      postedAt: "2026-07-13T10:00:01Z",
      description: "Immutable flight settlement MC 020",
      commandType: "revenue",
      transactionCurrency: "USD",
      source: { entityType: "flight_settlement", entityId: flightBoard.items[0]!.id },
      lines: [
        {
          accountCode: "1000",
          accountName: "Cash",
          side: "debit",
          transactionAmountMinor: "3600000",
          reportingAmountMinor: "3600000",
        },
        {
          accountCode: "4100",
          accountName: "Operating result",
          side: "credit",
          transactionAmountMinor: "3600000",
          reportingAmountMinor: "3600000",
        },
      ],
    },
  ],
};

const notificationCenter: NotificationCenter = {
  asOf: flightBoard.asOf,
  unreadCount: 2,
  nextCursor: null,
  items: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      eventId: "7",
      eventType: "flight.suspended",
      severity: "critical",
      title: "Flight MC 021 suspended",
      body: "Dispatch fuel is unavailable. The flight remains safely suspended.",
      resourceType: "dated_flight",
      resourceId: flightBoard.items[0]!.id,
      recoveryAction: {
        label: "Review flight recovery",
        resourceType: "dated_flight",
        resourceId: flightBoard.items[0]!.id,
        path: `/app?view=operations&flight=${flightBoard.items[0]!.id}`,
      },
      occurredAt: "2026-07-13T11:00:00Z",
      createdAt: "2026-07-13T11:00:02Z",
      readAt: null,
    },
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      eventId: "8",
      eventType: "financial.obligation_due",
      severity: "warning",
      title: "Lease obligation due in seven days",
      body: "USD 125,000 is scheduled from the founder operating lease.",
      resourceType: "aircraft_lease",
      resourceId: aircraft.leaseId,
      recoveryAction: null,
      occurredAt: "2026-07-13T12:00:00Z",
      createdAt: "2026-07-13T12:00:01Z",
      readAt: null,
    },
  ],
};

const notificationPreferences: NotificationPreferences = {
  browserEnabled: false,
  minimumBrowserSeverity: "warning",
  quietHours: { start: "22:00", end: "07:00", timeZone: "America/New_York" },
};

export default async function ShellTestHarness({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; map?: string; view?: string }>;
}) {
  if (process.env.MAP_TEST_HARNESS !== "enabled") notFound();
  const query = await searchParams;
  const fleet: ListFleetResponse = [
    query.state === "pending"
      ? ({ ...aircraft, deliveryState: "pending", deliveredAt: null } as ListFleetResponse[number])
      : aircraft,
  ];
  if (query.view === "operations") {
    return (
      <AppShell
        career={career}
        fleet={fleet}
        userEmail="dispatcher@example.test"
        activeView="operations"
      >
        <OperationsWorkspace
          board={flightBoard}
          changes={flightChanges}
          airlineId={career.airlineId}
          reportingCurrency={career.reportingCurrency}
        />
      </AppShell>
    );
  }
  if (query.view === "finance") {
    return (
      <AppShell
        career={career}
        fleet={fleet}
        userEmail="dispatcher@example.test"
        activeView="finance"
      >
        <FinanceWorkspace
          overview={financeOverview}
          statements={financeStatements}
          journals={journals}
        />
      </AppShell>
    );
  }
  if (query.view === "notifications") {
    return (
      <AppShell
        career={career}
        fleet={fleet}
        userEmail="dispatcher@example.test"
        activeView="notifications"
      >
        <NotificationWorkspace
          center={notificationCenter}
          initialPreferences={notificationPreferences}
        />
      </AppShell>
    );
  }
  return (
    <AppShell
      career={career}
      fleet={fleet}
      userEmail="dispatcher@example.test"
      activeView="network"
    >
      <NetworkWorkspace
        airlineId={career.airlineId}
        baseAirportId={career.principalBase.airportId}
        reportingCurrency={career.reportingCurrency}
        airports={airports}
        fleet={fleet}
        initialRoutes={[]}
        initialPlanning={null}
        initialWeather={null}
        initialPricingStrategies={[]}
        {...(query.map === "degraded" ? { mapStyleUrl: "/__map-style-failure__.json" } : {})}
      />
    </AppShell>
  );
}
