export type HealthResponse = Readonly<{
  service: "api" | "worker";
  status: "ok";
}>;

export type DependencyStatus = "up" | "down";

export type ReadinessResponse = Readonly<{
  service: HealthResponse["service"];
  status: "ready" | "not_ready";
  dependencies: Readonly<{
    postgres: DependencyStatus;
    redis: DependencyStatus;
  }>;
}>;

export type ErrorDetail = Readonly<{ field?: string; issue: string }>;

export type ErrorEnvelope = Readonly<{
  error: Readonly<{
    code: string;
    message: string;
    requestId: string;
    details?: readonly ErrorDetail[];
  }>;
}>;

export type PaginationQuery = Readonly<{ cursor?: string; limit?: number }>;
export type PageMetadata = Readonly<{ nextCursor: string | null; limit: number }>;
export type SampleCommandRequest = Readonly<{ message: string }>;
export type SampleCommandResponse = Readonly<{
  message: string;
  commandId: string;
  transactionId: string;
  executedAt: string;
}>;

export type FoundingSelectionRequest = Readonly<{
  airlineName: string;
  fictionalIdentityConfirmed: boolean;
  homeJurisdiction: string;
  principalBaseIataCode: string;
  reportingCurrency: "CHF" | "EUR" | "GBP" | "JPY" | "KWD" | "USD";
  brand: Readonly<{ primaryColor: string; secondaryColor: string; logoMark: string }>;
  acceptFoundingLoan: boolean;
  worldRulesetVersion: string;
}>;

const exactMinorSchema = { type: "string", pattern: "^[0-9]+$" } as const;
const foundingSelectionProperties = {
  airlineName: { type: "string", minLength: 3, maxLength: 80 },
  fictionalIdentityConfirmed: { type: "boolean" },
  homeJurisdiction: { type: "string", pattern: "^[A-Z]{2}$" },
  principalBaseIataCode: { type: "string", pattern: "^[A-Z]{3}$" },
  reportingCurrency: { type: "string", enum: ["CHF", "EUR", "GBP", "JPY", "KWD", "USD"] },
  brand: {
    type: "object",
    additionalProperties: false,
    required: ["primaryColor", "secondaryColor", "logoMark"],
    properties: {
      primaryColor: { type: "string", pattern: "^#[0-9A-F]{6}$" },
      secondaryColor: { type: "string", pattern: "^#[0-9A-F]{6}$" },
      logoMark: { type: "string", pattern: "^[A-Z0-9]{1,3}$" },
    },
  },
  acceptFoundingLoan: { type: "boolean" },
  worldRulesetVersion: { type: "string", minLength: 1, maxLength: 100 },
} as const;

export const foundingSelectionRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "airlineName",
    "fictionalIdentityConfirmed",
    "homeJurisdiction",
    "principalBaseIataCode",
    "reportingCurrency",
    "brand",
    "acceptFoundingLoan",
    "worldRulesetVersion",
  ],
  properties: foundingSelectionProperties,
} as const;

const principalBaseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["airportId", "iataCode", "name", "countryCode", "stationServiceModel"],
  properties: {
    airportId: { type: "string", format: "uuid" },
    iataCode: { type: "string" },
    name: { type: "string" },
    countryCode: { type: "string" },
    stationServiceModel: { type: "string", const: "outsourced" },
  },
} as const;

const assumptionsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["included", "excludedUntilTicket09", "method"],
  properties: {
    included: { type: "array", items: { type: "string" } },
    excludedUntilTicket09: { type: "array", items: { type: "string" } },
    method: { type: "string" },
  },
} as const;

const runwaySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "currency",
    "openingCashMinor",
    "founderEquityMinor",
    "foundingLoanProceedsMinor",
    "baselineDailyObligationMinor",
    "scheduledLoanRepaymentsMinor",
    "runwayDays",
    "forecastHorizonDays",
    "assumptions",
    "explanation",
  ],
  properties: {
    currency: foundingSelectionProperties.reportingCurrency,
    openingCashMinor: exactMinorSchema,
    founderEquityMinor: exactMinorSchema,
    foundingLoanProceedsMinor: exactMinorSchema,
    baselineDailyObligationMinor: exactMinorSchema,
    scheduledLoanRepaymentsMinor: exactMinorSchema,
    runwayDays: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    forecastHorizonDays: { type: "integer", minimum: 1 },
    assumptions: assumptionsSchema,
    explanation: { type: "string" },
  },
} as const;

const financingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["founderEquityMinor", "optionalLoan"],
  properties: {
    founderEquityMinor: exactMinorSchema,
    optionalLoan: {
      type: "object",
      additionalProperties: false,
      required: [
        "principalMinor",
        "annualRateBasisPoints",
        "termDays",
        "installmentCount",
        "selected",
        "schedule",
      ],
      properties: {
        principalMinor: exactMinorSchema,
        annualRateBasisPoints: { type: "integer", minimum: 0 },
        termDays: { type: "integer", minimum: 1 },
        installmentCount: { type: "integer", minimum: 1 },
        selected: { type: "boolean" },
        schedule: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "installmentNumber",
              "dueAt",
              "principalMinor",
              "interestMinor",
              "totalMinor",
            ],
            properties: {
              installmentNumber: { type: "integer", minimum: 1 },
              dueAt: { type: "string", format: "date-time" },
              principalMinor: exactMinorSchema,
              interestMinor: exactMinorSchema,
              totalMinor: exactMinorSchema,
            },
          },
        },
      },
    },
  },
} as const;

const foundingPreviewProperties = {
  normalizedAirlineName: { type: "string" },
  catalogReleaseVersion: { type: "string" },
  worldRulesetVersion: { type: "string" },
  foundingBalanceVersion: { type: "string" },
  principalBase: principalBaseSchema,
  financing: financingSchema,
  runway: runwaySchema,
  nextStep: { type: "string", const: "select_founder_aircraft" },
  nextStepGuidance: { type: "string" },
} as const;

const foundingPreviewRequired = [
  "normalizedAirlineName",
  "catalogReleaseVersion",
  "worldRulesetVersion",
  "foundingBalanceVersion",
  "principalBase",
  "financing",
  "runway",
  "nextStep",
  "nextStepGuidance",
] as const;

export const foundingPreviewResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: foundingPreviewRequired,
  properties: foundingPreviewProperties,
} as const;

export const foundingConfirmationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    ...foundingPreviewRequired,
    "careerId",
    "airlineId",
    "stationId",
    "ledgerBookId",
    "careerStatus",
    "foundedAt",
  ],
  properties: {
    ...foundingPreviewProperties,
    careerId: { type: "string", format: "uuid" },
    airlineId: { type: "string", format: "uuid" },
    stationId: { type: "string", format: "uuid" },
    ledgerBookId: { type: "string", format: "uuid" },
    careerStatus: { type: "string", const: "active" },
    foundedAt: { type: "string", format: "date-time" },
  },
} as const;

export const airlineIdentifierParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["airlineId"],
  properties: { airlineId: { type: "string", format: "uuid" } },
} as const;

export const airlineSummaryResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "careerId",
    "airlineId",
    "name",
    "normalizedAirlineName",
    "brand",
    "careerStatus",
    "airlineStatus",
    "homeJurisdiction",
    "reportingCurrency",
    "catalogReleaseVersion",
    "worldRulesetVersion",
    "foundingBalanceVersion",
    "principalBase",
    "cashMinor",
    "equityMinor",
    "loanLiabilityMinor",
    "nextStep",
    "nextStepGuidance",
  ],
  properties: {
    careerId: { type: "string", format: "uuid" },
    airlineId: { type: "string", format: "uuid" },
    name: { type: "string" },
    normalizedAirlineName: { type: "string" },
    brand: foundingSelectionProperties.brand,
    careerStatus: { type: "string", enum: ["active", "insolvent", "closed"] },
    airlineStatus: { type: "string", enum: ["active", "insolvent", "closed"] },
    homeJurisdiction: { type: "string" },
    reportingCurrency: foundingSelectionProperties.reportingCurrency,
    catalogReleaseVersion: { type: "string" },
    worldRulesetVersion: { type: "string" },
    foundingBalanceVersion: { type: "string" },
    principalBase: principalBaseSchema,
    cashMinor: exactMinorSchema,
    equityMinor: exactMinorSchema,
    loanLiabilityMinor: exactMinorSchema,
    nextStep: { type: "string", const: "select_founder_aircraft" },
    nextStepGuidance: { type: "string" },
  },
} as const;

export const healthResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["service", "status"],
  properties: {
    service: { type: "string", enum: ["api", "worker"] },
    status: { type: "string", const: "ok" },
  },
} as const;

export const readinessResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["service", "status", "dependencies"],
  properties: {
    service: { type: "string", enum: ["api", "worker"] },
    status: { type: "string", enum: ["ready", "not_ready"] },
    dependencies: {
      type: "object",
      additionalProperties: false,
      required: ["postgres", "redis"],
      properties: {
        postgres: { type: "string", enum: ["up", "down"] },
        redis: { type: "string", enum: ["up", "down"] },
      },
    },
  },
} as const;

export const errorEnvelopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "requestId"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        requestId: { type: "string" },
        details: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["issue"],
            properties: {
              field: { type: "string" },
              issue: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

export const idempotencyHeadersSchema = {
  type: "object",
  additionalProperties: true,
  required: ["idempotency-key"],
  properties: {
    "idempotency-key": {
      type: "string",
      minLength: 8,
      maxLength: 128,
      pattern: "^[A-Za-z0-9._:-]+$",
    },
  },
} as const;

export const paginationQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    cursor: { type: "string", minLength: 1, maxLength: 512 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
  },
} as const;

export const pageMetadataSchema = {
  type: "object",
  additionalProperties: false,
  required: ["nextCursor", "limit"],
  properties: {
    nextCursor: { anyOf: [{ type: "string" }, { type: "null" }] },
    limit: { type: "integer", minimum: 1, maximum: 100 },
  },
} as const;

export const sampleCommandRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message"],
  properties: {
    message: { type: "string", minLength: 1, maxLength: 200 },
  },
} as const;

export const sampleCommandResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["message", "commandId", "transactionId", "executedAt"],
  properties: {
    message: { type: "string" },
    commandId: { type: "string", format: "uuid" },
    transactionId: { type: "string", format: "uuid" },
    executedAt: { type: "string", format: "date-time" },
  },
} as const;

export function createHealthResponse(service: HealthResponse["service"]): HealthResponse {
  return { service, status: "ok" };
}

export function createReadinessResponse(
  service: HealthResponse["service"],
  dependencies: Readonly<{ postgres: boolean; redis: boolean }>,
): ReadinessResponse {
  return {
    service,
    status: dependencies.postgres && dependencies.redis ? "ready" : "not_ready",
    dependencies: {
      postgres: dependencies.postgres ? "up" : "down",
      redis: dependencies.redis ? "up" : "down",
    },
  };
}

export * from "./generated/index.js";
export * from "./api-client.js";
