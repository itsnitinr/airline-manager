import type {
  ClientOptions,
  ConfirmAirlineFoundingData,
  ConfirmAirlineFoundingError,
  ConfirmAirlineFoundingResponse,
  ExecuteSampleCommandData,
  ExecuteSampleCommandError,
  ExecuteSampleCommandResponse,
  GetHealthResponse,
  GetAirlineCareerSummaryData,
  GetAirlineCareerSummaryError,
  GetAirlineCareerSummaryResponse,
  GetAirlineNextStepGuidanceData,
  GetAirlineNextStepGuidanceError,
  GetAirlineNextStepGuidanceResponse,
  GetReadinessError,
  GetReadinessResponse,
  PreviewAirlineFoundingData,
  PreviewAirlineFoundingError,
  PreviewAirlineFoundingResponse,
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
    eventsUrl: (input) => {
      const url = new URL(`${baseUrl}/v1/events`);
      if (input?.query?.cursor) url.searchParams.set("cursor", input.query.cursor);
      return url.toString();
    },
  };
}
