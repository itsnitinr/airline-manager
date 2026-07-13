import type {
  AcceptFounderLeaseData,
  AcceptFounderLeaseError,
  AcceptFounderLeaseResponse,
  ClientOptions,
  ConfirmAirlineFoundingData,
  ConfirmAirlineFoundingError,
  ConfirmAirlineFoundingResponse,
  ExecuteSampleCommandData,
  ExecuteSampleCommandError,
  ExecuteSampleCommandResponse,
  GetHealthResponse,
  GetAircraftDeliveryStatusData,
  GetAircraftDeliveryStatusError,
  GetAircraftDeliveryStatusResponse,
  GetAirlineCareerSummaryData,
  GetAirlineCareerSummaryError,
  GetAirlineCareerSummaryResponse,
  GetAirlineNextStepGuidanceData,
  GetAirlineNextStepGuidanceError,
  GetAirlineNextStepGuidanceResponse,
  GetCurrentPlayerCareerError,
  GetCurrentPlayerCareerResponse,
  GetFleetAircraftData,
  GetFleetAircraftError,
  GetFleetAircraftResponse,
  GetPublishedCatalogError,
  GetPublishedCatalogResponse,
  GetPublicConfigResponse,
  GetReadinessError,
  GetReadinessResponse,
  GetFuelCapacityOffersData,
  GetFuelCapacityOffersError,
  GetFuelCapacityOffersResponse,
  PurchaseFuelCapacityData,
  PurchaseFuelCapacityError,
  PurchaseFuelCapacityResponse,
  ForecastFuelData,
  ForecastFuelError,
  ForecastFuelResponse,
  GetFuelInventoryData,
  GetFuelInventoryError,
  GetFuelInventoryResponse,
  ListFuelLotsData,
  ListFuelLotsError,
  ListFuelLotsResponse,
  ListFuelMovementsData,
  ListFuelMovementsError,
  ListFuelMovementsResponse,
  ListFleetData,
  ListFleetError,
  ListFleetResponse,
  ListFounderPackageData,
  ListFounderPackageError,
  ListFounderPackageResponse,
  GetFuelPricesData,
  GetFuelPricesError,
  GetFuelPricesResponse,
  GetRouteWeatherForecastData,
  GetRouteWeatherForecastError,
  GetRouteWeatherForecastResponse,
  GetDepartureWeatherForecastData,
  GetDepartureWeatherForecastError,
  GetDepartureWeatherForecastResponse,
  PurchaseFuelData,
  PurchaseFuelError,
  PurchaseFuelResponse,
  CreateFuelQuoteData,
  CreateFuelQuoteError,
  CreateFuelQuoteResponse,
  SetFuelReserveData,
  SetFuelReserveError,
  SetFuelReserveResponse,
  PreviewAirlineFoundingData,
  PreviewAirlineFoundingError,
  PreviewAirlineFoundingResponse,
  PreviewFounderLeaseData,
  PreviewFounderLeaseError,
  PreviewFounderLeaseResponse,
  SubscribeToEventsData,
} from "./generated/index.js";

export class ApiClientError<TError> extends Error {
  readonly status: number;
  readonly body: TError;

  constructor(status: number, body: TError) {
    super(`Airline Manager API request failed with status ${status}.`);
    this.name = "ApiClientError";
    this.status = status;
    this.body = body;
  }
}

export type AirlineManagerApiClient = Readonly<{
  getHealth: () => Promise<GetHealthResponse>;
  getReadiness: () => Promise<GetReadinessResponse | GetReadinessError>;
  getPublicConfig: () => Promise<GetPublicConfigResponse>;
  getPublishedCatalog: () => Promise<GetPublishedCatalogResponse>;
  getCurrentPlayerCareer: () => Promise<GetCurrentPlayerCareerResponse>;
  executeSampleCommand: (
    input: Pick<ExecuteSampleCommandData, "body" | "headers">,
  ) => Promise<ExecuteSampleCommandResponse>;
  previewAirlineFounding: (
    input: Pick<PreviewAirlineFoundingData, "body">,
  ) => Promise<PreviewAirlineFoundingResponse>;
  confirmAirlineFounding: (
    input: Pick<ConfirmAirlineFoundingData, "body" | "headers">,
  ) => Promise<ConfirmAirlineFoundingResponse>;
  getAirlineCareerSummary: (
    input: Pick<GetAirlineCareerSummaryData, "path">,
  ) => Promise<GetAirlineCareerSummaryResponse>;
  getAirlineNextStepGuidance: (
    input: Pick<GetAirlineNextStepGuidanceData, "path">,
  ) => Promise<GetAirlineNextStepGuidanceResponse>;
  listFounderPackage: (
    input: Pick<ListFounderPackageData, "path">,
  ) => Promise<ListFounderPackageResponse>;
  previewFounderLease: (
    input: Pick<PreviewFounderLeaseData, "path" | "body">,
  ) => Promise<PreviewFounderLeaseResponse>;
  acceptFounderLease: (
    input: Pick<AcceptFounderLeaseData, "path" | "body" | "headers">,
  ) => Promise<AcceptFounderLeaseResponse>;
  listFleet: (input: Pick<ListFleetData, "path">) => Promise<ListFleetResponse>;
  getFleetAircraft: (
    input: Pick<GetFleetAircraftData, "path">,
  ) => Promise<GetFleetAircraftResponse>;
  getAircraftDeliveryStatus: (
    input: Pick<GetAircraftDeliveryStatusData, "path">,
  ) => Promise<GetAircraftDeliveryStatusResponse>;
  getFuelPrices: (
    input: Pick<GetFuelPricesData, "path" | "query">,
  ) => Promise<GetFuelPricesResponse>;
  createFuelQuote: (
    input: Pick<CreateFuelQuoteData, "path" | "body">,
  ) => Promise<CreateFuelQuoteResponse>;
  purchaseFuel: (
    input: Pick<PurchaseFuelData, "path" | "body" | "headers">,
  ) => Promise<PurchaseFuelResponse>;
  getFuelInventory: (
    input: Pick<GetFuelInventoryData, "path">,
  ) => Promise<GetFuelInventoryResponse>;
  listFuelLots: (input: Pick<ListFuelLotsData, "path">) => Promise<ListFuelLotsResponse>;
  listFuelMovements: (
    input: Pick<ListFuelMovementsData, "path">,
  ) => Promise<ListFuelMovementsResponse>;
  setFuelReserve: (
    input: Pick<SetFuelReserveData, "path" | "body" | "headers">,
  ) => Promise<SetFuelReserveResponse>;
  forecastFuel: (input: Pick<ForecastFuelData, "path" | "body">) => Promise<ForecastFuelResponse>;
  getFuelCapacityOffers: (
    input: Pick<GetFuelCapacityOffersData, "path">,
  ) => Promise<GetFuelCapacityOffersResponse>;
  purchaseFuelCapacity: (
    input: Pick<PurchaseFuelCapacityData, "path" | "body" | "headers">,
  ) => Promise<PurchaseFuelCapacityResponse>;
  getRouteWeatherForecast: (
    input: Pick<GetRouteWeatherForecastData, "path" | "query">,
  ) => Promise<GetRouteWeatherForecastResponse>;
  getDepartureWeatherForecast: (
    input: Pick<GetDepartureWeatherForecastData, "path">,
  ) => Promise<GetDepartureWeatherForecastResponse>;
  eventsUrl: (input?: Pick<SubscribeToEventsData, "query">) => string;
}>;

export function createApiClient(
  options: ClientOptions & { fetch?: typeof globalThis.fetch },
): AirlineManagerApiClient {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  async function readJson<TResponse, TError>(
    path: string,
    init?: RequestInit,
    acceptedStatuses: readonly number[] = [200],
  ): Promise<TResponse> {
    const response = await fetchImplementation(`${baseUrl}${path}`, init);
    const body = (await response.json()) as TResponse | TError;
    if (!acceptedStatuses.includes(response.status)) {
      throw new ApiClientError(response.status, body as TError);
    }
    return body as TResponse;
  }

  return {
    getHealth: () => readJson<GetHealthResponse, never>("/health"),
    getReadiness: () =>
      readJson<GetReadinessResponse | GetReadinessError, never>("/ready", undefined, [200, 503]),
    getPublicConfig: () => readJson<GetPublicConfigResponse, never>("/v1/public/config"),
    getPublishedCatalog: () =>
      readJson<GetPublishedCatalogResponse, GetPublishedCatalogError>("/v1/catalog/current"),
    getCurrentPlayerCareer: () =>
      readJson<GetCurrentPlayerCareerResponse, GetCurrentPlayerCareerError>("/v1/player/career", {
        credentials: "include",
      }),
    executeSampleCommand: (input) =>
      readJson<ExecuteSampleCommandResponse, ExecuteSampleCommandError>(
        "/v1/system/commands/sample",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": input.headers["idempotency-key"],
          },
          body: JSON.stringify(input.body),
        },
      ),
    previewAirlineFounding: (input) =>
      readJson<PreviewAirlineFoundingResponse, PreviewAirlineFoundingError>(
        "/v1/airlines/founding/preview",
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.body),
        },
      ),
    confirmAirlineFounding: (input) =>
      readJson<ConfirmAirlineFoundingResponse, ConfirmAirlineFoundingError>(
        "/v1/airlines/founding/confirm",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "idempotency-key": input.headers["idempotency-key"],
          },
          body: JSON.stringify(input.body),
        },
        [201],
      ),
    getAirlineCareerSummary: (input) =>
      readJson<GetAirlineCareerSummaryResponse, GetAirlineCareerSummaryError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}`,
        { credentials: "include" },
      ),
    getAirlineNextStepGuidance: (input) =>
      readJson<GetAirlineNextStepGuidanceResponse, GetAirlineNextStepGuidanceError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/next-step`,
        { credentials: "include" },
      ),
    listFounderPackage: (input) =>
      readJson<ListFounderPackageResponse, ListFounderPackageError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/founder-package`,
        { credentials: "include" },
      ),
    previewFounderLease: (input) =>
      readJson<PreviewFounderLeaseResponse, PreviewFounderLeaseError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/founder-package/preview`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.body),
        },
      ),
    acceptFounderLease: (input) =>
      readJson<AcceptFounderLeaseResponse, AcceptFounderLeaseError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/founder-lease/accept`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "idempotency-key": input.headers["idempotency-key"],
          },
          body: JSON.stringify(input.body),
        },
        [201],
      ),
    listFleet: (input) =>
      readJson<ListFleetResponse, ListFleetError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/fleet`,
        { credentials: "include" },
      ),
    getFleetAircraft: (input) =>
      readJson<GetFleetAircraftResponse, GetFleetAircraftError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/fleet/${encodeURIComponent(input.path.aircraftId)}`,
        { credentials: "include" },
      ),
    getAircraftDeliveryStatus: (input) =>
      readJson<GetAircraftDeliveryStatusResponse, GetAircraftDeliveryStatusError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/fleet/${encodeURIComponent(input.path.aircraftId)}/delivery-status`,
        { credentials: "include" },
      ),
    getFuelPrices: (input) => {
      const query = input.query?.recentBuckets ? `?recentBuckets=${input.query.recentBuckets}` : "";
      return readJson<GetFuelPricesResponse, GetFuelPricesError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/fuel/prices${query}`,
        { credentials: "include" },
      );
    },
    createFuelQuote: (input) =>
      readJson<CreateFuelQuoteResponse, CreateFuelQuoteError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/fuel/quotes`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.body),
        },
        [201],
      ),
    purchaseFuel: (input) =>
      readJson<PurchaseFuelResponse, PurchaseFuelError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/fuel/purchases`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "idempotency-key": input.headers["idempotency-key"],
          },
          body: JSON.stringify(input.body),
        },
        [201],
      ),
    getFuelInventory: (input) =>
      readJson<GetFuelInventoryResponse, GetFuelInventoryError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/fuel/inventory`,
        { credentials: "include" },
      ),
    listFuelLots: (input) =>
      readJson<ListFuelLotsResponse, ListFuelLotsError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/fuel/lots`,
        { credentials: "include" },
      ),
    listFuelMovements: (input) =>
      readJson<ListFuelMovementsResponse, ListFuelMovementsError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/fuel/movements`,
        { credentials: "include" },
      ),
    setFuelReserve: (input) =>
      readJson<SetFuelReserveResponse, SetFuelReserveError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/fuel/reserve`,
        {
          method: "PUT",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "idempotency-key": input.headers["idempotency-key"],
          },
          body: JSON.stringify(input.body),
        },
      ),
    forecastFuel: (input) =>
      readJson<ForecastFuelResponse, ForecastFuelError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/fuel/forecast`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.body),
        },
      ),
    getFuelCapacityOffers: (input) =>
      readJson<GetFuelCapacityOffersResponse, GetFuelCapacityOffersError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/fuel/capacity-offers`,
        { credentials: "include" },
      ),
    purchaseFuelCapacity: (input) =>
      readJson<PurchaseFuelCapacityResponse, PurchaseFuelCapacityError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/fuel/capacity-upgrades`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "idempotency-key": input.headers["idempotency-key"],
          },
          body: JSON.stringify(input.body),
        },
        [201],
      ),
    getRouteWeatherForecast: (input) => {
      const query = new URLSearchParams({ validAt: input.query.validAt });
      return readJson<GetRouteWeatherForecastResponse, GetRouteWeatherForecastError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/routes/${encodeURIComponent(input.path.routeId)}/weather-forecast?${query.toString()}`,
        { credentials: "include" },
      );
    },
    getDepartureWeatherForecast: (input) =>
      readJson<GetDepartureWeatherForecastResponse, GetDepartureWeatherForecastError>(
        `/v1/airlines/${encodeURIComponent(input.path.airlineId)}/departures/${encodeURIComponent(input.path.datedFlightId)}/weather-forecast`,
        { credentials: "include" },
      ),
    eventsUrl: (input) => {
      const url = new URL(`${baseUrl}/v1/events`);
      if (input?.query?.cursor) url.searchParams.set("cursor", input.query.cursor);
      return url.toString();
    },
  };
}
