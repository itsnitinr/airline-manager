CREATE TABLE schema_migrations (
  name text PRIMARY KEY,
  checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE schema_migrations IS
  'Forward-only SQL migrations applied by the production migration runner.';

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL CHECK (aggregate_type <> ''),
  aggregate_id uuid NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
  event_type text NOT NULL CHECK (event_type <> ''),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  CONSTRAINT outbox_events_aggregate_event_key
    UNIQUE (aggregate_type, aggregate_id, aggregate_version, event_type),
  CONSTRAINT outbox_events_publication_time_order
    CHECK (published_at IS NULL OR published_at >= occurred_at)
);

CREATE INDEX outbox_events_available_unpublished_idx
  ON outbox_events (available_at, occurred_at, id)
  WHERE published_at IS NULL;

CREATE INDEX outbox_events_aggregate_idx
  ON outbox_events (aggregate_type, aggregate_id, aggregate_version);

CREATE TABLE idempotency_commands (
  scope text NOT NULL CHECK (scope <> ''),
  idempotency_key text NOT NULL CHECK (idempotency_key <> ''),
  command_type text NOT NULL CHECK (command_type <> ''),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'started' CHECK (state IN ('started', 'completed', 'failed')),
  response_status integer CHECK (response_status BETWEEN 100 AND 599),
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, idempotency_key),
  CONSTRAINT idempotency_commands_completion_shape CHECK (
    (state = 'completed' AND response_status IS NOT NULL)
    OR (state <> 'completed' AND response_status IS NULL AND response_body IS NULL)
  ),
  CONSTRAINT idempotency_commands_time_order CHECK (
    updated_at >= created_at AND expires_at > created_at
  )
);

CREATE INDEX idempotency_commands_expiry_idx ON idempotency_commands (expires_at);

CREATE TABLE administrative_audit_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_identifier text NOT NULL CHECK (actor_identifier <> ''),
  action text NOT NULL CHECK (action <> ''),
  resource_type text NOT NULL CHECK (resource_type <> ''),
  resource_identifier text NOT NULL CHECK (resource_identifier <> ''),
  request_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason <> ''),
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT administrative_audit_records_request_action_key
    UNIQUE (request_id, action, resource_type, resource_identifier),
  CONSTRAINT administrative_audit_records_before_object
    CHECK (before_state IS NULL OR jsonb_typeof(before_state) = 'object'),
  CONSTRAINT administrative_audit_records_after_object
    CHECK (after_state IS NULL OR jsonb_typeof(after_state) = 'object')
);

CREATE INDEX administrative_audit_records_actor_time_idx
  ON administrative_audit_records (actor_identifier, occurred_at DESC);

CREATE INDEX administrative_audit_records_resource_time_idx
  ON administrative_audit_records (resource_type, resource_identifier, occurred_at DESC);

CREATE FUNCTION reject_administrative_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'administrative audit records are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER administrative_audit_records_append_only
  BEFORE UPDATE OR DELETE ON administrative_audit_records
  FOR EACH ROW EXECUTE FUNCTION reject_administrative_audit_mutation();

COMMENT ON COLUMN outbox_events.aggregate_version IS
  'Positive optimistic version of the aggregate after the state transition.';
COMMENT ON COLUMN outbox_events.occurred_at IS
  'UTC instant stored as timestamptz; clients must not use timestamp without time zone.';
