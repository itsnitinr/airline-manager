export type HealthResponse = Readonly<{
  service: "api" | "worker";
  status: "ok";
}>;

export function createHealthResponse(service: HealthResponse["service"]): HealthResponse {
  return { service, status: "ok" };
}
