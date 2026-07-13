import type { ListFleetResponse } from "@airline-manager/contracts";
import { describe, expect, it } from "vitest";
import { maintenanceForecastAircraft, selectedMaintenanceAircraft } from "./fleet-read-model";

const pending = { id: "pending", deliveryState: "pending" } as ListFleetResponse[number];
const delivered = { id: "delivered", deliveryState: "delivered" } as ListFleetResponse[number];

describe("maintenance aircraft read selection", () => {
  it("does not request maintenance reads for aircraft awaiting delivery", () => {
    const fleet = [pending, delivered] as ListFleetResponse;

    expect(maintenanceForecastAircraft(fleet)).toEqual([delivered]);
    expect(selectedMaintenanceAircraft(fleet, pending.id)).toBeNull();
    expect(selectedMaintenanceAircraft(fleet)).toBe(delivered);
    expect(selectedMaintenanceAircraft(fleet, "unknown")).toBe(delivered);
  });
});
