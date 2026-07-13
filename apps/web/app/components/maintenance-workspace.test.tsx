import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebApiError } from "../lib/client-api";
import { planningApi } from "../lib/planning-api";
import { MaintenanceWorkspace } from "./maintenance-workspace";

vi.mock("../lib/planning-api", async () => {
  const actual = await vi.importActual<typeof import("../lib/planning-api")>("../lib/planning-api");
  return {
    ...actual,
    planningApi: {
      ...actual.planningApi,
      scheduleMaintenance: vi.fn(),
      maintenanceForecast: vi.fn(),
    },
  };
});

const program = {
  id: "program",
  version: "maintenance-v1",
  aircraftVariantId: "variant",
  aircraftVariantCode: "atr-72-600",
  utilizationFormulaVersion: "utilization-v1",
  conditionFormulaVersion: "condition-v1",
  faultFormulaVersion: "fault-v1",
  calendarSemantics: "elapsed_utc_days",
  rules: [
    {
      id: "rule",
      code: "line-check",
      name: "Line check",
      kind: "line",
      intervalHoursMinutes: "30000",
      hardLimit: false,
      maximumDeferralHoursMinutes: "600",
      maximumDeferralCycles: "2",
      maximumDeferralCalendarDays: 2,
      durationMinutes: 120,
      workforceCapacity: 1,
      costMinor: "50000",
      conditionRestoreBasisPoints: 250,
    },
  ],
} as const;

const forecast = {
  aircraftId: "aircraft",
  generatedAt: "2026-07-13T00:00:00Z",
  programVersion: "maintenance-v1",
  dispatchReady: true,
  conditionBasisPoints: 9900,
  dispatchReliabilityBasisPoints: 9980,
  due: [
    {
      ruleCode: "line-check",
      state: "due",
      hoursMinutesRemaining: "0",
      hardLimitExceeded: false,
      explanation: "Line check has reached a due threshold.",
      recoveryStep: "Reserve a qualified line-maintenance window.",
    },
  ],
  plannedWork: [],
  activeFaults: [],
  scheduleConflicts: ["AM20 occupies the requested window."],
  workforceNeeds: ["One line-maintenance worker required."],
  explanations: ["Derived from authoritative utilization counters."],
  recoverySteps: ["Move the rotation or maintenance window."],
} as const;

describe("maintenance planning constraints", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves the planned window and links occupancy conflicts to route and workforce recovery", async () => {
    vi.mocked(planningApi.scheduleMaintenance).mockRejectedValue(
      new WebApiError(409, {
        code: "occupancy_conflict",
        message: "This maintenance window overlaps aircraft occupancy.",
        fields: {},
        details: [{ code: "occupancy_conflict", issue: "AM20 occupies this aircraft." }],
        recoverable: true,
      }),
    );
    const user = userEvent.setup();
    render(
      <MaintenanceWorkspace
        airlineId="airline"
        fleetDetail={
          {
            aircraft: {
              id: "aircraft",
              serialNumber: "ATR-001",
              manufacturer: "ATR",
              model: "72-600",
            },
            lease: { currency: "USD" },
          } as Parameters<typeof MaintenanceWorkspace>[0]["fleetDetail"]
        }
        initialProgram={program}
        initialForecast={forecast}
        history={[]}
      />,
    );

    const start = screen.getByLabelText("Window start") as HTMLInputElement;
    const enteredValue = start.value;
    await user.click(screen.getByRole("button", { name: "Preview constraints and schedule" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("AM20 occupies this aircraft."),
    );
    expect(start).toHaveValue(enteredValue);
    expect(
      screen.getByRole("link", { name: "Review aircraft rotation occupancy" }),
    ).toHaveAttribute("href", "/app?view=network");
    expect(screen.getByRole("link", { name: "restore line-maintenance capacity" })).toHaveAttribute(
      "href",
      "/app?view=workforce",
    );
  });
});
