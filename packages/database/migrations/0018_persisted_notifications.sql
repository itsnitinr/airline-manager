CREATE TABLE notification_preferences (
  player_account_id uuid PRIMARY KEY REFERENCES player_accounts (id) ON DELETE CASCADE,
  browser_enabled boolean NOT NULL DEFAULT false,
  minimum_browser_severity text NOT NULL DEFAULT 'warning'
    CHECK (minimum_browser_severity IN ('info', 'warning', 'critical')),
  quiet_hours_start time,
  quiet_hours_end time,
  quiet_hours_time_zone text,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((quiet_hours_start IS NULL AND quiet_hours_end IS NULL AND quiet_hours_time_zone IS NULL)
    OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL
      AND quiet_hours_time_zone IS NOT NULL AND quiet_hours_time_zone <> ''))
);

CREATE TABLE notification_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_outbox_event_id uuid NOT NULL UNIQUE,
  player_account_id uuid NOT NULL REFERENCES player_accounts (id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type <> ''),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title text NOT NULL CHECK (title <> ''),
  body text NOT NULL CHECK (body <> ''),
  resource_type text NOT NULL CHECK (resource_type <> ''),
  resource_id uuid NOT NULL,
  recovery_action jsonb CHECK (recovery_action IS NULL OR jsonb_typeof(recovery_action) = 'object'),
  correlation_id uuid NOT NULL,
  causation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX notification_intents_player_time_idx
  ON notification_intents (player_account_id, occurred_at, id);

CREATE SEQUENCE player_notification_event_sequence AS bigint;
CREATE TABLE player_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_sequence bigint NOT NULL DEFAULT nextval('player_notification_event_sequence') UNIQUE,
  intent_id uuid NOT NULL UNIQUE REFERENCES notification_intents (id) ON DELETE RESTRICT,
  player_account_id uuid NOT NULL REFERENCES player_accounts (id) ON DELETE RESTRICT,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (read_at IS NULL OR read_at >= created_at)
);
CREATE INDEX player_notifications_account_cursor_idx
  ON player_notifications (player_account_id, event_sequence);
CREATE INDEX player_notifications_account_unread_idx
  ON player_notifications (player_account_id, event_sequence) WHERE read_at IS NULL;

CREATE FUNCTION enqueue_account_notification_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.player_account_id IS NOT NULL AND NEW.outcome = 'succeeded'
    AND NEW.event_type IN ('account.registered', 'account.email_verified', 'account.password_reset') THEN
    INSERT INTO outbox_events
      (aggregate_type, aggregate_id, aggregate_version, event_type, payload, causation_id)
    VALUES ('security_audit_event', NEW.id, 1, NEW.event_type || '.v1',
      jsonb_build_object('playerAccountId', NEW.player_account_id), NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER security_audit_account_notification_outbox
  AFTER INSERT ON security_audit_events FOR EACH ROW EXECUTE FUNCTION enqueue_account_notification_outbox();

COMMENT ON TABLE notification_intents IS
  'Idempotent player-facing projections of authoritative outbox events; delivery is advisory.';
COMMENT ON COLUMN player_notifications.event_sequence IS
  'Stable resumable SSE cursor. Sequence gaps are expected and reveal no foreign event contents.';
