export const playerRoles = ["player", "administrator"] as const;
export type PlayerRole = (typeof playerRoles)[number];

export type PlayerAccount = Readonly<{
  id: string;
  authenticationUserId: string;
  createdAt: Date;
}>;

export type OwnedResource = Readonly<{
  resourceType: string;
  resourceId: string;
  playerAccountId: string;
}>;

/**
 * Durable identity persistence boundary. Resource IDs are deliberately opaque:
 * ticket 08 can bind an airline UUID without this module depending on Airline.
 */
export interface IdentityRepository {
  findPlayerByAuthenticationUserId(
    authenticationUserId: string,
  ): Promise<PlayerAccount | undefined>;
  createPlayerForAuthenticationUser(authenticationUserId: string): Promise<PlayerAccount>;
  findRoles(playerAccountId: string): Promise<readonly PlayerRole[]>;
  ownsResource(playerAccountId: string, resourceType: string, resourceId: string): Promise<boolean>;
  listOwnedResourceIds(playerAccountId: string, resourceType: string): Promise<readonly string[]>;
  bindResourceOwnership(ownership: OwnedResource): Promise<void>;
}
