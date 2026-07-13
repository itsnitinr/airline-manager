import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  FinanceOverview,
  FinanceStatements,
  FlightBoard,
  JournalPage,
  NotificationCenter,
  NotificationPreferences,
  OfflineFlightChanges,
} from "@airline-manager/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinanceWorkspace } from "./finance-workspace";
import { NotificationWorkspace } from "./notification-workspace";
import { OperationsWorkspace } from "./operations-workspace";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  markNotification: vi.fn(async () => ({})),
  markAllNotifications: vi.fn(async () => ({
    updated: 1,
    readAt: "2026-07-13T12:00:00Z",
  })),
  saveNotificationPreferences: vi.fn(async (value: NotificationPreferences) => value),
}));
const { refresh, markNotification } = mocks;

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("./live-authority-status", () => ({
  LiveAuthorityStatus: () => <p>Live updates connected</p>,
}));
vi.mock("../map/airport-map", () => ({ AirportMap: () => <div>Operational map</div> }));
vi.mock("../lib/ticket21-api", () => ({
  monitoringApi: {
    markNotification: mocks.markNotification,
    markAllNotifications: mocks.markAllNotifications,
    saveNotificationPreferences: mocks.saveNotificationPreferences,
    flightStatus: vi.fn(),
    flightSettlement: vi.fn(),
  },
}));

const board: FlightBoard = {
  asOf: "2026-07-13T12:00:00Z",
  from: "2026-07-12T12:00:00Z",
  to: "2026-07-20T12:00:00Z",
  truncated: false,
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      airlineId: "22222222-2222-4222-8222-222222222222",
      routeId: "33333333-3333-4333-8333-333333333333",
      aircraftId: "44444444-4444-4444-8444-444444444444",
      flightNumber: "OP21",
      state: "suspended",
      version: "3",
      departureAt: "2026-07-14T12:00:00Z",
      scheduledArrivalAt: "2026-07-14T13:00:00Z",
      departureLocal: "2026-07-14 08:00",
      arrivalLocal: "2026-07-14 09:00",
      effectiveAt: "2026-07-13T11:00:00Z",
      origin: {
        id: "55555555-5555-4555-8555-555555555555",
        iataCode: "JFK",
        name: "John F Kennedy International",
        timeZone: "America/New_York",
        latitudeDeg: "40.6",
        longitudeDeg: "-73.7",
      },
      destination: {
        id: "66666666-6666-4666-8666-666666666666",
        iataCode: "PHL",
        name: "Philadelphia International",
        timeZone: "America/New_York",
        latitudeDeg: "39.8",
        longitudeDeg: "-75.2",
      },
      aircraft: { serialNumber: "FND-ATR", variant: "ATR-72-600", currentAirportId: null },
      delayMinutes: 15,
      passengersBooked: "54",
      passengersCarried: null,
      bookedRevenueMinor: "320000",
      reportingCurrency: "USD",
      weatherImpact: {
        summary: "Generated operational forecast is frozen with this dated flight.",
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
const changes: OfflineFlightChanges = {
  asOf: board.asOf,
  since: board.from,
  through: board.asOf,
  total: 1,
  byState: { suspended: 1 },
  items: [
    {
      flightId: board.items[0]!.id,
      flightNumber: "OP21",
      fromState: "scheduled",
      toState: "suspended",
      effectiveAt: "2026-07-13T11:00:00Z",
      explanation: "Dispatch fuel unavailable.",
    },
  ],
};

const overview: FinanceOverview = {
  asOf: "2026-07-13T12:00:00Z",
  reportingCurrency: "USD",
  supportedTransactionCurrencies: ["USD"],
  cashMinor: "10000000",
  upcomingObligationsMinor: "500000",
  runwayDays: 600,
  runwayHorizonDays: 30,
  runwayExplanation: "Cash divided by scheduled obligations.",
  obligations: [],
  routeProfitability: [
    {
      routeId: board.items[0]!.routeId,
      originIataCode: "JFK",
      destinationIataCode: "PHL",
      realizedRevenueMinor: "100000",
      realizedCostMinor: "60000",
      operatingResultMinor: "40000",
      settledFlights: 1,
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
const statements: FinanceStatements = {
  period: { from: "2026-07-01T00:00:00Z", to: "2026-08-01T00:00:00Z" },
  asOf: overview.asOf,
  reportingCurrency: "USD",
  basis: "posted_double_entry_ledger",
  profitAndLoss: { rows: [], netIncomeMinor: "40000" },
  balanceSheet: {
    rows: [],
    assetsMinor: "10000000",
    liabilitiesAndEquityMinor: "9960000",
    currentEarningsMinor: "40000",
  },
  cashFlow: { rows: [], netCashChangeMinor: "40000" },
  reconciliation: {
    journalsBalanced: true,
    trialBalanceDifferenceMinor: "0",
    balanceSheetDifferenceMinor: "0",
  },
};
const journals: JournalPage = {
  asOf: overview.asOf,
  reportingCurrency: "USD",
  nextCursor: null,
  items: [],
};

const center: NotificationCenter = {
  asOf: overview.asOf,
  unreadCount: 1,
  nextCursor: null,
  items: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      eventId: "7",
      eventType: "flight.suspended",
      severity: "critical",
      title: "Flight suspended",
      body: "Fuel is unavailable for dispatch.",
      resourceType: "dated_flight",
      resourceId: board.items[0]!.id,
      recoveryAction: {
        label: "Review recovery",
        resourceType: "dated_flight",
        resourceId: board.items[0]!.id,
        path: `/app?view=operations&flight=${board.items[0]!.id}`,
      },
      occurredAt: overview.asOf,
      createdAt: overview.asOf,
      readAt: null,
    },
  ],
};
const preferences: NotificationPreferences = {
  browserEnabled: false,
  minimumBrowserSeverity: "warning",
  quietHours: null,
};

beforeEach(() => vi.clearAllMocks());

describe("ticket 21 workspaces", () => {
  it("renders the operational map equivalent, offline changes, state, and safe recovery", async () => {
    render(
      <OperationsWorkspace
        board={board}
        changes={changes}
        airlineId={board.items[0]!.airlineId}
        reportingCurrency="USD"
      />,
    );
    expect(screen.getByText("Operational map")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /accessible equivalent/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OP21" })).toBeInTheDocument();
    expect(screen.getByText(/1 changes since/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Fuel suspension/i })).toHaveAttribute(
      "href",
      "/app?view=fuel",
    );
    await userEvent.selectOptions(screen.getByLabelText("State"), "settled");
    expect(screen.getByText(/No flights match/i)).toBeInTheDocument();
  });

  it("keeps finance analytical and exposes reconciled statements on demand", async () => {
    render(<FinanceWorkspace overview={overview} statements={statements} journals={journals} />);
    expect(screen.getByText("Ledger cash")).toBeInTheDocument();
    expect(screen.getByText("Route profitability")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Statements" }));
    expect(await screen.findByText("Ledger and statements reconcile")).toBeInTheDocument();
    expect(screen.getByText("Profit and loss")).toBeInTheDocument();
  });

  it("filters the persisted inbox and refreshes only after authoritative read mutations", async () => {
    render(<NotificationWorkspace center={center} initialPreferences={preferences} />);
    expect(screen.getByText("Flight suspended")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review recovery" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/app\?view=operations/),
    );
    await userEvent.click(screen.getByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(markNotification).toHaveBeenCalledWith(center.items[0]!.id, true));
    expect(refresh).toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText("Severity"), "warning");
    expect(screen.getByText(/No persisted notifications match/i)).toBeInTheDocument();
  });
});
