import {
  anonymousAuthorizationContext,
  type AuthorizationContext,
} from "@airline-manager/application";
import { KyselyIdentityRepository, type Database } from "@airline-manager/database";
import { fromNodeHeaders } from "better-auth/node";
import type { AuthenticationAdapter } from "./better-auth.js";

export function createAuthorizationResolver(
  auth: AuthenticationAdapter,
  database: Database,
): (input: {
  requestId: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
}) => Promise<AuthorizationContext> {
  const identities = new KyselyIdentityRepository(database);
  return async ({ headers }) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
    if (!session) return anonymousAuthorizationContext;
    const player = await identities.findPlayerByAuthenticationUserId(session.user.id);
    if (!player) return anonymousAuthorizationContext;
    return {
      authenticated: true,
      authenticationUserId: session.user.id,
      playerAccountId: player.id,
      emailVerified: session.user.emailVerified,
      roles: await identities.findRoles(player.id),
    };
  };
}
