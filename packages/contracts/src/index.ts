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
