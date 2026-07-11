import type { ErrorEnvelope } from "@airline-manager/contracts";
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
