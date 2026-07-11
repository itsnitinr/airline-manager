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
