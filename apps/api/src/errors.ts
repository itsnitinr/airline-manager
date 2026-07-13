import type { ErrorEnvelope } from "@airline-manager/contracts";
import { AuthorizationError } from "@airline-manager/application";
import {
  FleetDomainError,
  FoundingDomainError,
  FuelDomainError,
  MarketDomainError,
  SchedulingDomainError,
  WorkforceDomainError,
  MaintenanceDomainError,
  WeatherDomainError,
  FlightLifecycleError,
  NotificationDomainError,
} from "@airline-manager/domain";
import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";

function envelope(
  request: FastifyRequest,
  code: string,
  message: string,
  details?: ErrorEnvelope["error"]["details"],
): ErrorEnvelope {
  return details === undefined
    ? { error: { code, message, requestId: request.id } }
    : { error: { code, message, requestId: request.id, details } };
}

function validationDetails(error: FastifyError): ErrorEnvelope["error"]["details"] {
  return error.validation?.map((issue) => ({
    field: issue.instancePath || String(issue.params.missingProperty ?? "request"),
    issue: issue.message ?? "is invalid",
  }));
}

export function registerErrorMapping(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .send(envelope(request, "not_found", "The requested resource was not found."));
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AuthorizationError) {
      void reply.status(error.statusCode).send(envelope(request, error.code, error.message));
      return;
    }
    if (error instanceof FoundingDomainError) {
      const conflictCodes = new Set([
        "active_airline_exists",
        "airline_name_unavailable",
        "idempotency_conflict",
      ]);
      void reply
        .status(
          conflictCodes.has(error.code) ? 409 : error.code === "founding_not_found" ? 403 : 400,
        )
        .send(envelope(request, error.code, error.message));
      return;
    }
    if (error instanceof FleetDomainError) {
      const conflictCodes = new Set([
        "founder_lease_already_accepted",
        "idempotency_conflict",
        "aircraft_not_due",
        "stale_aircraft_version",
        "invalid_lease_transition",
      ]);
      const hiddenCodes = new Set(["aircraft_not_found", "founder_package_not_found"]);
      void reply
        .status(hiddenCodes.has(error.code) ? 403 : conflictCodes.has(error.code) ? 409 : 400)
        .send(envelope(request, error.code, error.message));
      return;
    }
    if (error instanceof FuelDomainError) {
      const conflictCodes = new Set([
        "idempotency_conflict",
        "fuel_quote_expired",
        "fuel_quote_already_accepted",
        "insufficient_cash",
        "fuel_capacity_exceeded",
        "insufficient_fuel",
        "fuel_movement_already_reversed",
      ]);
      const hiddenCodes = new Set([
        "fuel_not_found",
        "fuel_quote_not_found",
        "fuel_quote_wrong_airline",
        "fuel_movement_not_found",
      ]);
      void reply
        .status(hiddenCodes.has(error.code) ? 403 : conflictCodes.has(error.code) ? 409 : 400)
        .send(envelope(request, error.code, error.message));
      return;
    }
    if (error instanceof MarketDomainError) {
      const conflictCodes = new Set([
        "idempotency_conflict",
        "offer_already_exists",
        "stale_booking_checkpoint",
        "booking_window_closed",
      ]);
      const hiddenCodes = new Set([
        "market_not_found",
        "commercial_offer_not_found",
        "pricing_strategy_not_found",
      ]);
      void reply
        .status(hiddenCodes.has(error.code) ? 403 : conflictCodes.has(error.code) ? 409 : 400)
        .send(envelope(request, error.code, error.message));
      return;
    }
    if (error instanceof SchedulingDomainError) {
      const hidden = new Set(["route_not_found", "aircraft_not_found", "timetable_not_found"]);
      const conflict = new Set([
        "idempotency_conflict",
        "historical_flight_protected",
        "invalid_rotation",
      ]);
      void reply.status(hidden.has(error.code) ? 403 : conflict.has(error.code) ? 409 : 400).send(
        envelope(
          request,
          error.code,
          error.message,
          error.issues.map((issue) => ({
            code: issue.code,
            ...(issue.field ? { field: issue.field } : {}),
            issue: `${issue.message} Suggested correction: ${issue.suggestedCorrection}`,
          })),
        ),
      );
      return;
    }
    if (error instanceof WorkforceDomainError) {
      const hidden = new Set(["workforce_not_found", "flight_not_found"]);
      const conflict = new Set([
        "idempotency_conflict",
        "workforce_shortage",
        "wage_checkpoint_not_due",
      ]);
      void reply.status(hidden.has(error.code) ? 403 : conflict.has(error.code) ? 409 : 400).send(
        envelope(
          request,
          error.code,
          error.message,
          error.shortages.map((shortage) => ({
            field: shortage.role,
            issue: `${shortage.baseIataCode} ${shortage.qualificationCode} ${shortage.windowStartsAt}-${shortage.windowEndsAt}: required ${shortage.requiredCapacity}, available ${shortage.availableCapacity}, shortfall ${shortage.shortfall}. ${shortage.correction}`,
          })),
        ),
      );
      return;
    }
    if (error instanceof MaintenanceDomainError) {
      const hidden = new Set([
        "maintenance_not_found",
        "aircraft_not_found",
        "rule_not_found",
        "fault_not_found",
        "work_package_not_found",
      ]);
      const conflict = new Set([
        "occupancy_conflict",
        "workforce_shortage",
        "dispatch_blocked",
        "idempotency_conflict",
        "work_not_due",
      ]);
      void reply.status(hidden.has(error.code) ? 403 : conflict.has(error.code) ? 409 : 400).send(
        envelope(
          request,
          error.code,
          error.message,
          error.explanations.map((issue) => ({ issue })),
        ),
      );
      return;
    }
    if (error instanceof WeatherDomainError) {
      const hidden = error.code === "weather_not_found";
      const conflict = error.code === "idempotency_conflict";
      void reply
        .status(hidden ? 403 : conflict ? 409 : 400)
        .send(envelope(request, error.code, error.message));
      return;
    }
    if (error instanceof FlightLifecycleError) {
      const hidden = error.code === "flight_not_found";
      void reply.status(hidden ? 403 : 409).send(
        envelope(
          request,
          error.code,
          error.message,
          error.recoverySteps.map((issue) => ({ issue })),
        ),
      );
      return;
    }
    if (error instanceof NotificationDomainError) {
      void reply.status(403).send(envelope(request, error.code, error.message));
      return;
    }
    if (error.validation) {
      void reply
        .status(400)
        .send(
          envelope(
            request,
            "validation_error",
            "The request did not match the required schema.",
            validationDetails(error),
          ),
        );
      return;
    }

    if (error.statusCode === 429) {
      void reply.status(429).send(envelope(request, "rate_limited", "Too many requests."));
      return;
    }

    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const isServerError = statusCode >= 500;
    request.log[isServerError ? "error" : "warn"](
      { requestId: request.id, errorName: error.name, statusCode },
      "request failed",
    );
    void reply
      .status(statusCode)
      .send(
        envelope(
          request,
          isServerError ? "internal_error" : "request_error",
          isServerError ? "An unexpected error occurred." : error.message,
        ),
      );
  });
}
