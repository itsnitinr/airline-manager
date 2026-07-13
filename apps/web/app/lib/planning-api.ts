import type {
  ActivateWeeklyTimetableResponse,
  CreateDirectRouteResponse,
  CreateFuelQuoteResponse,
  CreatePassengerPricingStrategyResponse,
  ForecastFuelResponse,
  ForecastWorkforceResponse,
  GetAircraftMaintenanceForecastResponse,
  GetAircraftMaintenanceProgramResponse,
  GetFleetAircraftPlanningDetailResponse,
  GetFuelCapacityOffersResponse,
  GetFuelInventoryResponse,
  GetFuelPricesResponse,
  GetRoutePlanningResponse,
  GetRouteWeatherForecastResponse,
  GetWorkforceRecommendationsResponse,
  HireWorkforceResponse,
  ListAircraftMaintenanceHistoryResponse,
  ListDirectRoutesResponse,
  ListFuelLotsResponse,
  ListFuelMovementsResponse,
  ListPassengerPricingStrategiesResponse,
  ListWorkforcePoolsResponse,
  PurchaseFuelCapacityResponse,
  PurchaseFuelResponse,
  ResearchDirectRouteResponse,
  ScheduleAircraftMaintenanceWorkResponse,
  SetFuelReserveResponse,
  TimetableActivationRequest,
} from "@airline-manager/contracts";
import type {
  MaintenanceForecast,
  MaintenanceProgram,
  WorkforcePool,
} from "@airline-manager/domain";
import { browserFetch } from "./client-api";

export type PlanningWorkforcePool = WorkforcePool;
export type PlanningMaintenanceForecast = MaintenanceForecast;
export type PlanningMaintenanceProgram = MaintenanceProgram;

export const planningApi = {
  researchRoute: (
    airlineId: string,
    input: { origin: string; destination: string; aircraftId: string; at?: string },
  ) => {
    const query = new URLSearchParams({
      origin: input.origin,
      destination: input.destination,
      aircraftId: input.aircraftId,
      ...(input.at ? { at: input.at } : {}),
    });
    return browserFetch<ResearchDirectRouteResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/routes/research?${query}`,
    );
  },
  createRoute: (
    airlineId: string,
    input: { originIataCode: string; destinationIataCode: string; aircraftId: string },
    idempotencyKey: string,
  ) =>
    browserFetch<CreateDirectRouteResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/routes`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(input),
      },
    ),
  listRoutes: (airlineId: string) =>
    browserFetch<ListDirectRoutesResponse>(`/v1/airlines/${encodeURIComponent(airlineId)}/routes`),
  routePlanning: (airlineId: string, routeId: string) =>
    browserFetch<GetRoutePlanningResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/routes/${encodeURIComponent(routeId)}/planning`,
    ),
  activateTimetable: (
    airlineId: string,
    routeId: string,
    input: TimetableActivationRequest,
    idempotencyKey: string,
  ) =>
    browserFetch<ActivateWeeklyTimetableResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/routes/${encodeURIComponent(routeId)}/timetables`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(input),
      },
    ),
  pricingStrategies: (airlineId: string, marketId: string) =>
    browserFetch<ListPassengerPricingStrategiesResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/markets/${encodeURIComponent(marketId)}/pricing-strategies`,
    ),
  updatePricing: (
    airlineId: string,
    input: {
      marketId: string;
      effectiveFrom: string;
      posture: "value" | "balanced" | "yield";
      baseFareMinor: string;
      minimumFareMinor: string;
      maximumFareMinor: string;
      loadFactorTargetBasisPoints: number;
      revenueTargetMinor: string;
    },
    idempotencyKey: string,
  ) =>
    browserFetch<CreatePassengerPricingStrategyResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/markets/pricing-strategies`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(input),
      },
    ),
  fleetPlanning: (airlineId: string, aircraftId: string) =>
    browserFetch<GetFleetAircraftPlanningDetailResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/fleet/${encodeURIComponent(aircraftId)}/planning`,
    ),
  fuelPrices: (airlineId: string) =>
    browserFetch<GetFuelPricesResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/fuel/prices?recentBuckets=24`,
    ),
  fuelInventory: (airlineId: string) =>
    browserFetch<GetFuelInventoryResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/fuel/inventory`,
    ),
  fuelLots: (airlineId: string) =>
    browserFetch<ListFuelLotsResponse>(`/v1/airlines/${encodeURIComponent(airlineId)}/fuel/lots`),
  fuelMovements: (airlineId: string) =>
    browserFetch<ListFuelMovementsResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/fuel/movements`,
    ),
  fuelCapacityOffers: (airlineId: string) =>
    browserFetch<GetFuelCapacityOffersResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/fuel/capacity-offers`,
    ),
  quoteFuel: (airlineId: string, quantityKg: string) =>
    browserFetch<CreateFuelQuoteResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/fuel/quotes`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quantityKg }),
      },
    ),
  purchaseFuel: (airlineId: string, quoteId: string, idempotencyKey: string) =>
    browserFetch<PurchaseFuelResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/fuel/purchases`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ quoteId }),
      },
    ),
  setFuelReserve: (airlineId: string, planningReservedKg: string, idempotencyKey: string) =>
    browserFetch<SetFuelReserveResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/fuel/reserve`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ planningReservedKg }),
      },
    ),
  forecastFuel: (airlineId: string, projectedConsumptionKg: string) =>
    browserFetch<ForecastFuelResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/fuel/forecast`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectedConsumptionKg }),
      },
    ),
  purchaseFuelCapacity: (airlineId: string, tier: number, idempotencyKey: string) =>
    browserFetch<PurchaseFuelCapacityResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/fuel/capacity-upgrades`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ tier }),
      },
    ),
  workforcePools: (airlineId: string) =>
    browserFetch<ListWorkforcePoolsResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/workforce/pools`,
    ),
  workforceRecommendations: (airlineId: string) =>
    browserFetch<GetWorkforceRecommendationsResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/workforce/recommendations`,
    ),
  forecastWorkforce: (airlineId: string, through: string) =>
    browserFetch<ForecastWorkforceResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/workforce/forecast`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ through }),
      },
    ),
  hireWorkforce: (
    airlineId: string,
    input: {
      role: "pilot" | "cabin_crew" | "line_maintenance" | "ground_handling";
      capacity: number;
      qualificationAircraftVariantId?: string;
    },
    idempotencyKey: string,
  ) =>
    browserFetch<HireWorkforceResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/workforce/hiring`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(input),
      },
    ),
  maintenanceProgram: (airlineId: string, aircraftId: string) =>
    browserFetch<GetAircraftMaintenanceProgramResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/aircraft/${encodeURIComponent(aircraftId)}/maintenance/program`,
    ),
  maintenanceForecast: (airlineId: string, aircraftId: string) =>
    browserFetch<GetAircraftMaintenanceForecastResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/aircraft/${encodeURIComponent(aircraftId)}/maintenance/forecast`,
    ),
  maintenanceHistory: (airlineId: string, aircraftId: string) =>
    browserFetch<ListAircraftMaintenanceHistoryResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/aircraft/${encodeURIComponent(aircraftId)}/maintenance/history`,
    ),
  scheduleMaintenance: (
    airlineId: string,
    aircraftId: string,
    input: { startsAt: string; ruleCode?: string; faultId?: string },
    idempotencyKey: string,
  ) =>
    browserFetch<ScheduleAircraftMaintenanceWorkResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/aircraft/${encodeURIComponent(aircraftId)}/maintenance/windows`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(input),
      },
    ),
  routeWeather: (airlineId: string, routeId: string, validAt: string) =>
    browserFetch<GetRouteWeatherForecastResponse>(
      `/v1/airlines/${encodeURIComponent(airlineId)}/routes/${encodeURIComponent(routeId)}/weather-forecast?validAt=${encodeURIComponent(validAt)}`,
    ),
};

export function asWorkforcePools(value: ListWorkforcePoolsResponse): PlanningWorkforcePool[] {
  return value.filter(isWorkforcePool);
}

function isWorkforcePool(value: unknown): value is PlanningWorkforcePool {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PlanningWorkforcePool>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.baseIataCode === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.activeCapacity === "number" &&
    typeof candidate.pendingCapacity === "number" &&
    Boolean(candidate.qualification && typeof candidate.qualification.code === "string")
  );
}

export function asMaintenanceProgram(
  value: GetAircraftMaintenanceProgramResponse,
): PlanningMaintenanceProgram {
  return value as unknown as PlanningMaintenanceProgram;
}

export function asMaintenanceForecast(
  value: GetAircraftMaintenanceForecastResponse,
): PlanningMaintenanceForecast {
  return value as unknown as PlanningMaintenanceForecast;
}
