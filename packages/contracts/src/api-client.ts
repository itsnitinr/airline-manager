import type {
  ClientOptions,
  ExecuteSampleCommandData,
  ExecuteSampleCommandError,
  ExecuteSampleCommandResponse,
  GetHealthResponse,
  GetReadinessError,
  GetReadinessResponse,
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
    eventsUrl: (input) => {
      const url = new URL(`${baseUrl}/v1/events`);
      if (input?.query?.cursor) url.searchParams.set("cursor", input.query.cursor);
      return url.toString();
    },
  };
}
