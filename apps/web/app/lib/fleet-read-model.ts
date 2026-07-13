import type { ListFleetResponse } from "@airline-manager/contracts";

type FleetAircraft = ListFleetResponse[number];

export function maintenanceForecastAircraft(fleet: ListFleetResponse): readonly FleetAircraft[] {
  return fleet.filter(({ deliveryState }) => deliveryState === "delivered");
}

export function selectedMaintenanceAircraft(
  fleet: ListFleetResponse,
  requestedAircraftId?: string,
): FleetAircraft | null {
  if (requestedAircraftId) {
    const requested = fleet.find(({ id }) => id === requestedAircraftId);
    if (requested) return requested.deliveryState === "delivered" ? requested : null;
  }
  return maintenanceForecastAircraft(fleet)[0] ?? null;
}
