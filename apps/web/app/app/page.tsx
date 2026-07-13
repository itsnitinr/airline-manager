import type {
  ForecastWorkforceResponse,
  GetAircraftMaintenanceForecastResponse,
  GetAircraftMaintenanceProgramResponse,
  GetAirlineCareerSummaryResponse,
  GetFleetAircraftPlanningDetailResponse,
  GetFuelCapacityOffersResponse,
  GetFuelInventoryResponse,
  GetFuelPricesResponse,
  GetRoutePlanningResponse,
  GetRouteWeatherForecastResponse,
  GetWorkforceRecommendationsResponse,
  ListAircraftMaintenanceHistoryResponse,
  ListDirectRoutesResponse,
  ListFleetResponse,
  ListFuelLotsResponse,
  ListFuelMovementsResponse,
  ListPassengerPricingStrategiesResponse,
  ListWorkforcePoolsResponse,
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
import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { AppShell, type PlanningView } from "../components/app-shell";
import { FleetWorkspace } from "../components/fleet-workspace";
import { MaintenanceUnavailableWorkspace } from "../components/maintenance-unavailable-workspace";
import { asMaintenanceForecast, asMaintenanceProgram, asWorkforcePools } from "../lib/planning-api";
import { maintenanceForecastAircraft, selectedMaintenanceAircraft } from "../lib/fleet-read-model";
import { getCurrentCareer, getPublishedCatalog, getSession, serverApiFetch } from "../lib/api";

const NetworkWorkspace = dynamic(() =>
  import("../components/network-workspace").then(({ NetworkWorkspace }) => NetworkWorkspace),
);
const FuelWorkspace = dynamic(() =>
  import("../components/fuel-workspace").then(({ FuelWorkspace }) => FuelWorkspace),
);
const WorkforceWorkspace = dynamic(() =>
  import("../components/workforce-workspace").then(({ WorkforceWorkspace }) => WorkforceWorkspace),
);
const MaintenanceWorkspace = dynamic(() =>
  import("../components/maintenance-workspace").then(
    ({ MaintenanceWorkspace }) => MaintenanceWorkspace,
  ),
);
const OperationsWorkspace = dynamic(() =>
  import("../components/operations-workspace").then(
    ({ OperationsWorkspace }) => OperationsWorkspace,
  ),
);
const FinanceWorkspace = dynamic(() =>
  import("../components/finance-workspace").then(({ FinanceWorkspace }) => FinanceWorkspace),
);
const NotificationWorkspace = dynamic(() =>
  import("../components/notification-workspace").then(
    ({ NotificationWorkspace }) => NotificationWorkspace,
  ),
);

const planningViews = new Set<PlanningView>([
  "network",
  "fleet",
  "fuel",
  "workforce",
  "maintenance",
  "operations",
  "finance",
  "notifications",
]);

export default async function ApplicationPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    route?: string;
    aircraft?: string;
    flight?: string;
    since?: string;
  }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in?returnTo=/app");
  if (!session.user.emailVerified)
    redirect(`/verify-email?email=${encodeURIComponent(session.user.email)}`);

  const [current, catalog, query] = await Promise.all([
    getCurrentCareer(),
    getPublishedCatalog(),
    searchParams,
  ]);
  const career = current.career as GetAirlineCareerSummaryResponse | null;
  if (!career) redirect("/onboarding");
  const fleet = await serverApiFetch<ListFleetResponse>(`/v1/airlines/${career.airlineId}/fleet`);
  if (fleet.length === 0) redirect("/onboarding");

  const activeView = planningViews.has(query.view as PlanningView)
    ? (query.view as PlanningView)
    : "network";
  const airports = catalog.airports.map(({ id, iataCode, name, latitudeDeg, longitudeDeg }) => ({
    id,
    iataCode,
    name,
    latitudeDeg,
    longitudeDeg,
  }));

  return (
    <AppShell career={career} fleet={fleet} userEmail={session.user.email} activeView={activeView}>
      {await workspaceFor(activeView, query, career, fleet, airports)}
    </AppShell>
  );
}

async function workspaceFor(
  view: PlanningView,
  query: { route?: string; aircraft?: string; flight?: string; since?: string },
  career: GetAirlineCareerSummaryResponse,
  fleet: ListFleetResponse,
  airports: readonly {
    id: string;
    iataCode: string;
    name: string;
    latitudeDeg: string;
    longitudeDeg: string;
  }[],
) {
  const airlineId = career.airlineId;
  if (view === "operations") {
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60_000);
    const to = new Date(now.getTime() + 7 * 86_400_000);
    const requestedSince = query.since ? new Date(query.since) : from;
    const since =
      Number.isFinite(requestedSince.getTime()) && requestedSince <= now
        ? new Date(Math.max(requestedSince.getTime(), now.getTime() - 31 * 86_400_000))
        : from;
    const [board, changes] = await Promise.all([
      serverApiFetch<FlightBoard>(
        `/v1/airlines/${airlineId}/operations/flights?${new URLSearchParams({
          from: from.toISOString(),
          to: to.toISOString(),
          limit: "200",
        })}`,
      ),
      serverApiFetch<OfflineFlightChanges>(
        `/v1/airlines/${airlineId}/operations/changes?${new URLSearchParams({
          since: since.toISOString(),
          limit: "100",
        })}`,
      ),
    ]);
    return (
      <OperationsWorkspace
        board={board}
        changes={changes}
        airlineId={airlineId}
        reportingCurrency={career.reportingCurrency}
        {...(query.flight ? { initialFlightId: query.flight } : {})}
      />
    );
  }

  if (view === "finance") {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    const [overview, statements, journals] = await Promise.all([
      serverApiFetch<FinanceOverview>(`/v1/airlines/${airlineId}/finance/overview`),
      serverApiFetch<FinanceStatements>(
        `/v1/airlines/${airlineId}/finance/statements?${new URLSearchParams({
          from: from.toISOString(),
          to: to.toISOString(),
        })}`,
      ),
      serverApiFetch<JournalPage>(`/v1/airlines/${airlineId}/finance/journals?limit=25`),
    ]);
    return <FinanceWorkspace overview={overview} statements={statements} journals={journals} />;
  }

  if (view === "notifications") {
    const [center, preferences] = await Promise.all([
      serverApiFetch<NotificationCenter>("/v1/notification-center?limit=100"),
      serverApiFetch<NotificationPreferences>("/v1/notification-preferences"),
    ]);
    return <NotificationWorkspace center={center} initialPreferences={preferences} />;
  }
  if (view === "network") {
    const routes = await serverApiFetch<ListDirectRoutesResponse>(
      `/v1/airlines/${airlineId}/routes`,
    );
    const selected = routes.find(({ id }) => id === query.route) ?? routes[0];
    const validAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const [planning, weather, pricingStrategies] = selected
      ? await Promise.all([
          serverApiFetch<GetRoutePlanningResponse>(
            `/v1/airlines/${airlineId}/routes/${selected.id}/planning`,
          ),
          serverApiFetch<GetRouteWeatherForecastResponse>(
            `/v1/airlines/${airlineId}/routes/${selected.id}/weather-forecast?validAt=${encodeURIComponent(validAt)}`,
          ).catch(() => null),
          serverApiFetch<ListPassengerPricingStrategiesResponse>(
            `/v1/airlines/${airlineId}/markets/${selected.marketId}/pricing-strategies`,
          ),
        ])
      : [null, null, []];
    return (
      <NetworkWorkspace
        airlineId={airlineId}
        baseAirportId={career.principalBase.airportId}
        reportingCurrency={career.reportingCurrency}
        airports={airports}
        fleet={fleet}
        initialRoutes={routes}
        initialPlanning={planning}
        initialWeather={weather}
        initialPricingStrategies={pricingStrategies}
      />
    );
  }

  if (view === "fleet") {
    const maintenanceAircraft = maintenanceForecastAircraft(fleet);
    const [details, maintenance] = await Promise.all([
      Promise.all(
        fleet.map(({ id }) =>
          serverApiFetch<GetFleetAircraftPlanningDetailResponse>(
            `/v1/airlines/${airlineId}/fleet/${id}/planning`,
          ),
        ),
      ),
      Promise.all(
        maintenanceAircraft.map(({ id }) =>
          serverApiFetch<GetAircraftMaintenanceForecastResponse>(
            `/v1/airlines/${airlineId}/aircraft/${id}/maintenance/forecast`,
          ),
        ),
      ),
    ]);
    return <FleetWorkspace details={details} maintenance={maintenance} airports={airports} />;
  }

  if (view === "fuel") {
    const [prices, inventory, lots, movements, capacityOffers] = await Promise.all([
      serverApiFetch<GetFuelPricesResponse>(
        `/v1/airlines/${airlineId}/fuel/prices?recentBuckets=24`,
      ),
      serverApiFetch<GetFuelInventoryResponse>(`/v1/airlines/${airlineId}/fuel/inventory`),
      serverApiFetch<ListFuelLotsResponse>(`/v1/airlines/${airlineId}/fuel/lots`),
      serverApiFetch<ListFuelMovementsResponse>(`/v1/airlines/${airlineId}/fuel/movements`),
      serverApiFetch<GetFuelCapacityOffersResponse>(
        `/v1/airlines/${airlineId}/fuel/capacity-offers`,
      ),
    ]);
    return (
      <FuelWorkspace
        airlineId={airlineId}
        initialPrices={prices}
        initialInventory={inventory}
        initialLots={lots}
        initialMovements={movements}
        capacityOffers={capacityOffers}
      />
    );
  }

  if (view === "workforce") {
    const through = new Date(Date.now() + 28 * 86_400_000).toISOString();
    const [pools, recommendations, forecast] = await Promise.all([
      serverApiFetch<ListWorkforcePoolsResponse>(`/v1/airlines/${airlineId}/workforce/pools`),
      serverApiFetch<GetWorkforceRecommendationsResponse>(
        `/v1/airlines/${airlineId}/workforce/recommendations`,
      ),
      serverApiFetch<ForecastWorkforceResponse>(`/v1/airlines/${airlineId}/workforce/forecast`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ through }),
      }),
    ]);
    return (
      <WorkforceWorkspace
        airlineId={airlineId}
        initialPools={asWorkforcePools(pools)}
        recommendations={recommendations}
        initialForecast={forecast}
        fleet={fleet}
      />
    );
  }

  const requestedAircraft = query.aircraft
    ? (fleet.find(({ id }) => id === query.aircraft) ?? null)
    : null;
  const selectedAircraft = selectedMaintenanceAircraft(fleet, query.aircraft);
  if (!selectedAircraft) {
    return <MaintenanceUnavailableWorkspace aircraft={requestedAircraft ?? fleet[0]!} />;
  }
  const [fleetDetail, program, forecast, history] = await Promise.all([
    serverApiFetch<GetFleetAircraftPlanningDetailResponse>(
      `/v1/airlines/${airlineId}/fleet/${selectedAircraft.id}/planning`,
    ),
    serverApiFetch<GetAircraftMaintenanceProgramResponse>(
      `/v1/airlines/${airlineId}/aircraft/${selectedAircraft.id}/maintenance/program`,
    ),
    serverApiFetch<GetAircraftMaintenanceForecastResponse>(
      `/v1/airlines/${airlineId}/aircraft/${selectedAircraft.id}/maintenance/forecast`,
    ),
    serverApiFetch<ListAircraftMaintenanceHistoryResponse>(
      `/v1/airlines/${airlineId}/aircraft/${selectedAircraft.id}/maintenance/history`,
    ),
  ]);
  return (
    <MaintenanceWorkspace
      airlineId={airlineId}
      fleetDetail={fleetDetail}
      initialProgram={asMaintenanceProgram(program)}
      initialForecast={asMaintenanceForecast(forecast)}
      history={history}
    />
  );
}
