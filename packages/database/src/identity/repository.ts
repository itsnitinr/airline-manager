import type {
  IdentityRepository,
  OwnedResource,
  PlayerAccount,
  PlayerRole,
} from "@airline-manager/domain";
import type { Kysely, Transaction } from "kysely";
import type { DB } from "../generated/database.js";

type IdentityDatabase = Kysely<DB> | Transaction<DB>;

function mapPlayer(row: {
  id: string;
  authentication_user_id: string;
  created_at: Date;
}): PlayerAccount {
  return {
    id: row.id,
    authenticationUserId: row.authentication_user_id,
    createdAt: row.created_at,
  };
}

/** May be constructed with a transaction so ticket 08 can bind ownership atomically. */
export class KyselyIdentityRepository implements IdentityRepository {
  constructor(private readonly database: IdentityDatabase) {}

  async findPlayerByAuthenticationUserId(
    authenticationUserId: string,
  ): Promise<PlayerAccount | undefined> {
    const row = await this.database
      .selectFrom("player_accounts")
      .selectAll()
      .where("authentication_user_id", "=", authenticationUserId)
      .executeTakeFirst();
    return row ? mapPlayer(row) : undefined;
  }

  async createPlayerForAuthenticationUser(authenticationUserId: string): Promise<PlayerAccount> {
    await this.database
      .insertInto("player_accounts")
      .values({ authentication_user_id: authenticationUserId })
      .onConflict((conflict) => conflict.column("authentication_user_id").doNothing())
      .execute();
    const player = await this.findPlayerByAuthenticationUserId(authenticationUserId);
    if (!player) throw new Error("Player account creation did not persist.");
    await this.database
      .insertInto("player_account_roles")
      .values({ player_account_id: player.id, role: "player" })
      .onConflict((conflict) => conflict.columns(["player_account_id", "role"]).doNothing())
      .execute();
    return player;
  }

  async findRoles(playerAccountId: string): Promise<readonly PlayerRole[]> {
    const rows = await this.database
      .selectFrom("player_account_roles")
      .select("role")
      .where("player_account_id", "=", playerAccountId)
      .orderBy("role")
      .execute();
    return rows.map(({ role }) => role as PlayerRole);
  }

  async ownsResource(
    playerAccountId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<boolean> {
    const row = await this.database
      .selectFrom("resource_ownerships")
      .select("resource_id")
      .where("player_account_id", "=", playerAccountId)
      .where("resource_type", "=", resourceType)
      .where("resource_id", "=", resourceId)
      .executeTakeFirst();
    return row !== undefined;
  }

  async bindResourceOwnership(ownership: OwnedResource): Promise<void> {
    await this.database
      .insertInto("resource_ownerships")
      .values({
        player_account_id: ownership.playerAccountId,
        resource_type: ownership.resourceType,
        resource_id: ownership.resourceId,
      })
      .execute();
  }

  async listOwnedResourceIds(
    playerAccountId: string,
    resourceType: string,
  ): Promise<readonly string[]> {
    const rows = await this.database
      .selectFrom("resource_ownerships")
      .select("resource_id")
      .where("player_account_id", "=", playerAccountId)
      .where("resource_type", "=", resourceType)
      .orderBy("resource_id")
      .execute();
    return rows.map(({ resource_id }) => resource_id);
  }
}
