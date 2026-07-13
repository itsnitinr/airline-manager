import type { GetCurrentPublishedCatalogHandler } from "@airline-manager/application";
import {
  currentCatalogResponseSchema,
  errorEnvelopeSchema,
  publicConfigResponseSchema,
} from "@airline-manager/contracts";
import type { FastifyInstance } from "fastify";

export type PublicRouteOptions = Readonly<{
  catalog?: GetCurrentPublishedCatalogHandler;
  googleSignInAvailable: boolean;
}>;

export function registerPublicRoutes(app: FastifyInstance, options: PublicRouteOptions): void {
  app.get(
    "/v1/public/config",
    {
      schema: {
        operationId: "getPublicConfig",
        tags: ["system"],
        response: { 200: publicConfigResponseSchema },
      },
    },
    async () => ({ googleSignInAvailable: options.googleSignInAvailable }),
  );

  app.get(
    "/v1/catalog/current",
    {
      schema: {
        operationId: "getPublishedCatalog",
        tags: ["catalog"],
        response: {
          200: currentCatalogResponseSchema,
          503: errorEnvelopeSchema,
          500: errorEnvelopeSchema,
        },
      },
    },
    async (request, reply) => {
      const catalog = await options.catalog?.execute(
        {},
        { requestId: request.id, authorization: request.authorizationContext },
      );
      if (!catalog) {
        return reply.status(503).send({
          error: {
            code: "catalog_unavailable",
            message: "The published catalog is temporarily unavailable.",
            requestId: request.id,
          },
        });
      }
      return catalog;
    },
  );
}
