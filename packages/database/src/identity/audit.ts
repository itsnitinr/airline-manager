import type { Insertable, Kysely, Transaction } from "kysely";
import type { DB, SecurityAuditEvents } from "../generated/database.js";

export const securityAuditEventTypes = [
  "account.registered",
  "account.email_verified",
  "account.password_reset",
  "session.created",
  "session.revoked",
  "role.granted",
  "role.revoked",
  "authorization.denied",
] as const;

export type SecurityAuditEventType = (typeof securityAuditEventTypes)[number];
export type SecurityAuditWriter = Readonly<{
  record(
    event: Readonly<{
      eventType: SecurityAuditEventType;
      authenticationUserId?: string;
      playerAccountId?: string;
      requestId?: string;
      targetType: string;
      targetIdentifier: string;
      outcome: "succeeded" | "denied" | "failed";
      metadata?: Readonly<Record<string, boolean | number | string | null>>;
    }>,
  ): Promise<void>;
}>;

type AuditDatabase = Kysely<DB> | Transaction<DB>;

export function createSecurityAuditWriter(database: AuditDatabase): SecurityAuditWriter {
  return {
    async record(event) {
      const forbiddenMetadataKey = Object.keys(event.metadata ?? {}).find((key) =>
        /(password|secret|token|session|credential|authorization|cookie)/i.test(key),
      );
      if (forbiddenMetadataKey) {
        throw new Error(`Security audit metadata key is forbidden: ${forbiddenMetadataKey}`);
      }
      const row: Insertable<SecurityAuditEvents> = {
        event_type: event.eventType,
        authentication_user_id: event.authenticationUserId ?? null,
        player_account_id: event.playerAccountId ?? null,
        request_id: event.requestId ?? null,
        target_type: event.targetType,
        target_identifier: event.targetIdentifier,
        outcome: event.outcome,
        metadata: { ...(event.metadata ?? {}) },
      };
      await database.insertInto("security_audit_events").values(row).execute();
    },
  };
}
