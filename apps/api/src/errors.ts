import type { ErrorEnvelope } from "@airline-manager/contracts";
import { AuthorizationError } from "@airline-manager/application";
import {
  FleetDomainError,
  FoundingDomainError,
  FuelDomainError,
  MarketDomainError,
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
