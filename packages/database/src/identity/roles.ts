import type { PlayerRole } from "@airline-manager/domain";
import type { Database } from "../database.js";
import { createSecurityAuditWriter } from "./audit.js";

export async function setPlayerRole(
  database: Database,
  input: Readonly<{
    actorPlayerAccountId: string;
    targetPlayerAccountId: string;
    role: PlayerRole;
    granted: boolean;
    requestId: string;
  }>,
): Promise<void> {
  await database.transaction().execute(async (transaction) => {
    if (input.granted) {
      await transaction
        .insertInto("player_account_roles")
        .values({
          player_account_id: input.targetPlayerAccountId,
          role: input.role,
          granted_by_player_account_id: input.actorPlayerAccountId,
        })
        .onConflict((conflict) => conflict.columns(["player_account_id", "role"]).doNothing())
        .execute();
    } else {
      await transaction
        .deleteFrom("player_account_roles")
        .where("player_account_id", "=", input.targetPlayerAccountId)
        .where("role", "=", input.role)
        .execute();
    }
    await createSecurityAuditWriter(transaction).record({
      eventType: input.granted ? "role.granted" : "role.revoked",
      playerAccountId: input.actorPlayerAccountId,
      requestId: input.requestId,
      targetType: "player_account_role",
      targetIdentifier: input.targetPlayerAccountId,
      outcome: "succeeded",
      metadata: { role: input.role },
    });
  });
}
