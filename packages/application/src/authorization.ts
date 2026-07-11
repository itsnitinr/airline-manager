import type { IdentityRepository, PlayerRole } from "@airline-manager/domain";

export type AuthorizationContext = Readonly<{
  authenticated: boolean;
  authenticationUserId?: string;
  playerAccountId?: string;
  emailVerified: boolean;
  roles: readonly PlayerRole[];
}>;

export const anonymousAuthorizationContext: AuthorizationContext = Object.freeze({
  authenticated: false,
  emailVerified: false,
  roles: Object.freeze([]),
});

export class AuthorizationError extends Error {
  readonly statusCode: 401 | 403;
  readonly code: "authentication_required" | "verified_account_required" | "forbidden";

  constructor(
    code: AuthorizationError["code"],
    message: string,
    statusCode: AuthorizationError["statusCode"],
  ) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function requireVerifiedPlayer(
  authorization: AuthorizationContext,
): asserts authorization is AuthorizationContext & { playerAccountId: string } {
  if (!authorization.authenticated || !authorization.playerAccountId) {
    throw new AuthorizationError("authentication_required", "Authentication is required.", 401);
  }
  if (!authorization.emailVerified) {
    throw new AuthorizationError(
      "verified_account_required",
      "A verified player account is required.",
      403,
    );
  }
}

export function requireAdministrator(authorization: AuthorizationContext): void {
  requireVerifiedPlayer(authorization);
  if (!authorization.roles.includes("administrator")) {
    throw new AuthorizationError("forbidden", "Administrator access is required.", 403);
  }
}

export async function requireOwnedResource(
  repository: Pick<IdentityRepository, "ownsResource">,
  authorization: AuthorizationContext,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  requireVerifiedPlayer(authorization);
  if (!(await repository.ownsResource(authorization.playerAccountId, resourceType, resourceId))) {
    // Deliberately identical for missing and foreign resources to prevent enumeration.
    throw new AuthorizationError("forbidden", "The requested resource is not accessible.", 403);
  }
}
