import type { IdentityRepository } from "@airline-manager/domain";
import { describe, expect, it, vi } from "vitest";
import {
  AuthorizationError,
  requireAdministrator,
  requireOwnedResource,
  requireVerifiedPlayer,
  type AuthorizationContext,
} from "./authorization.js";

const player: AuthorizationContext = {
  authenticated: true,
  authenticationUserId: "auth-user",
  playerAccountId: "player-account",
  emailVerified: true,
  roles: ["player"],
};

describe("server-side authorization", () => {
  it("requires both authentication and verification", () => {
    expect(() =>
      requireVerifiedPlayer({ ...player, authenticated: false, emailVerified: false }),
    ).toThrowError(AuthorizationError);
    expect(() => requireVerifiedPlayer({ ...player, emailVerified: false })).toThrow(
      "verified player account",
    );
  });

  it("does not infer administrator capability from a client claim", () => {
    expect(() => requireAdministrator(player)).toThrow("Administrator access");
    expect(() =>
      requireAdministrator({ ...player, roles: ["player", "administrator"] }),
    ).not.toThrow();
  });

  it("rejects ID substitution using the persisted owner lookup", async () => {
    const ownsResource = vi.fn<IdentityRepository["ownsResource"]>().mockResolvedValue(false);
    await expect(
      requireOwnedResource({ ownsResource }, player, "airline", "foreign-airline"),
    ).rejects.toMatchObject({ code: "forbidden", statusCode: 403 });
    expect(ownsResource).toHaveBeenCalledWith("player-account", "airline", "foreign-airline");
  });
});
