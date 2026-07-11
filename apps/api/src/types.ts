import type { AuthorizationContext } from "@airline-manager/application";

declare module "fastify" {
  interface FastifyRequest {
    authorizationContext: AuthorizationContext;
  }
}

export type AuthorizationResolver = (input: {
  requestId: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
}) => Promise<AuthorizationContext>;

export type SseAuthorizationHook = (input: {
  authorization: AuthorizationContext;
  cursor?: string;
}) => Promise<void>;
