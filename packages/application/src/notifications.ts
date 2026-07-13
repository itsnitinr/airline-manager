import type {
  NotificationPreferences,
  NotificationRepository,
  PlayerNotification,
} from "@airline-manager/domain";
import { validateNotificationPreferences } from "@airline-manager/domain";
import { requireVerifiedPlayer } from "./authorization.js";
import type { JobEnvelopeV1 } from "./runtime.js";
import type { QueryContext } from "./index.js";

export class NotificationOutboxHandler {
  public constructor(private readonly notifications: NotificationRepository) {}

  public async handle(envelope: JobEnvelopeV1) {
    const eventType = envelope.routing.eventType;
    if (!eventType) return { kind: "noop" as const };
    return {
      kind: await this.notifications.consumeOutbox({
        entityType: envelope.entityType,
        entityId: envelope.entityId,
        expectedVersion: BigInt(envelope.expectedVersion),
        eventType,
      }),
    };
  }
}

export class NotificationService {
  public constructor(
    private readonly notifications: NotificationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private player(context: QueryContext): string {
    requireVerifiedPlayer(context.authorization);
    return context.authorization.playerAccountId;
  }

  list(
    afterEventId: bigint,
    limit: number,
    context: QueryContext,
  ): Promise<readonly PlayerNotification[]> {
    return this.notifications.list(
      this.player(context),
      afterEventId,
      Math.min(100, Math.max(1, limit)),
    );
  }

  markRead(
    notificationId: string,
    read: boolean,
    context: QueryContext,
  ): Promise<PlayerNotification> {
    return this.notifications.markRead(this.player(context), notificationId, read, this.now());
  }

  preferences(context: QueryContext): Promise<NotificationPreferences> {
    return this.notifications.preferences(this.player(context));
  }

  savePreferences(
    preferences: NotificationPreferences,
    context: QueryContext,
  ): Promise<NotificationPreferences> {
    validateNotificationPreferences(preferences);
    return this.notifications.savePreferences(this.player(context), preferences, this.now());
  }
}
