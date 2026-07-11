import { createSecurityAuditWriter, type Database } from "@airline-manager/database";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import type { AuthenticationAdapter } from "./better-auth.js";

const sensitiveKeys = new Set([
  "token",
  "password",
  "accessToken",
  "refreshToken",
  "idToken",
  "sessionToken",
]);

function publicJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveKeys.has(key))
      .map(([key, entry]) => {
        if (key === "session" && typeof entry === "object" && entry !== null) {
          const publicSession = Object.fromEntries(
            Object.entries(entry).filter(
              ([sessionKey]) => !["id", "token", "ipAddress", "userAgent"].includes(sessionKey),
            ),
          );
          return [key, publicJson(publicSession)];
        }
        return [key, publicJson(entry)];
      }),
  );
}

export function registerAuthenticationRoutes(
  app: FastifyInstance,
  auth: AuthenticationAdapter,
  database: Database,
): void {
  const audit = createSecurityAuditWriter(database);
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    logLevel: "silent",
    config: { rateLimit: false },
    async handler(request, reply) {
      const origin = `${request.protocol}://${request.headers.host ?? "localhost"}`;
      const url = new URL(request.raw.url ?? request.url, origin);
      const headers = fromNodeHeaders(request.headers);
      const body = request.body === undefined ? undefined : JSON.stringify(request.body);
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers,
          ...(body === undefined ? {} : { body }),
        }),
      );

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") void reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) void reply.header("set-cookie", cookies);

      const responseText = response.body ? await response.text() : "";
      const contentType = response.headers.get("content-type") ?? "";
      if (response.status >= 400 && request.method === "POST") {
        await audit.record({
          eventType: "authorization.denied",
          requestId: request.id,
          targetType: "auth_endpoint",
          targetIdentifier: url.pathname,
          outcome: "denied",
          metadata: { statusCode: response.status },
        });
      }
      if (!responseText) return reply.send();
      if (contentType.includes("application/json")) {
        return reply.send(publicJson(JSON.parse(responseText)));
      }
      return reply.send(responseText);
    },
  });
}
