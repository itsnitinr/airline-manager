ALTER TABLE outbox_events
  ADD COLUMN command_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN causation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN handler_kind text,
  ADD COLUMN handler_version integer NOT NULL DEFAULT 1 CHECK (handler_version > 0),
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  ADD COLUMN failed_at timestamptz,
  ADD COLUMN retained_until timestamptz;

UPDATE outbox_events SET handler_kind = 'outbox.event', next_attempt_at = available_at;
ALTER TABLE outbox_events ALTER COLUMN handler_kind SET NOT NULL;
ALTER TABLE outbox_events ALTER COLUMN handler_kind SET DEFAULT 'outbox.event';
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_lease_shape CHECK (
  (lease_owner IS NULL AND lease_expires_at IS NULL)
  OR (lease_owner IS NOT NULL AND lease_owner <> '' AND lease_expires_at IS NOT NULL)
);
ALTER TABLE outbox_events ADD CONSTRAINT outbox_events_failure_shape CHECK (
  (failed_at IS NULL) OR (published_at IS NULL AND failure_count > 0 AND last_error IS NOT NULL)
);
DROP INDEX outbox_events_available_unpublished_idx;
CREATE INDEX outbox_events_claim_idx
  ON outbox_events (next_attempt_at, available_at, occurred_at, id)
  WHERE published_at IS NULL AND failed_at IS NULL;
CREATE INDEX outbox_events_retention_idx
  ON outbox_events (retained_until, id) WHERE retained_until IS NOT NULL;

CREATE TABLE simulation_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type <> ''),
  entity_id uuid NOT NULL,
  expected_version bigint NOT NULL CHECK (expected_version > 0),
  handler_kind text NOT NULL CHECK (handler_kind <> ''),
  handler_version integer NOT NULL CHECK (handler_version > 0),
  target_time timestamptz NOT NULL,
  command_id uuid NOT NULL DEFAULT gen_random_uuid(),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  causation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  routing jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(routing) = 'object'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'applied', 'cancelled')),
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (entity_type, entity_id, expected_version, handler_kind, handler_version, target_time),
  CHECK ((lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND lease_owner <> '' AND lease_expires_at IS NOT NULL)),
  CHECK ((state = 'applied' AND applied_at IS NOT NULL) OR (state <> 'applied' AND applied_at IS NULL))
);
CREATE INDEX simulation_milestones_due_idx
  ON simulation_milestones (target_time, id) WHERE state = 'pending';

CREATE TABLE worker_dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text NOT NULL CHECK (job_id <> ''),
  queue_name text NOT NULL CHECK (queue_name <> ''),
  command_id uuid,
  entity_type text,
  entity_id uuid,
  handler_kind text,
  handler_version integer,
  envelope_version integer,
  envelope jsonb CHECK (envelope IS NULL OR jsonb_typeof(envelope) = 'object'),
  classification text NOT NULL CHECK (classification IN ('permanent', 'unsupported', 'exhausted')),
  diagnostic jsonb NOT NULL CHECK (jsonb_typeof(diagnostic) = 'object'),
  failed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  replayed_at timestamptz,
  UNIQUE (queue_name, job_id)
);
CREATE INDEX worker_dead_letters_expiry_idx ON worker_dead_letters (expires_at, id);

CREATE TABLE worker_replay_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  dead_letter_id uuid NOT NULL,
  actor_identifier text NOT NULL CHECK (actor_identifier <> ''),
  reason text NOT NULL CHECK (length(reason) >= 8),
  replay_job_id text NOT NULL CHECK (replay_job_id <> ''),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION reject_worker_replay_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'worker replay audits are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER worker_replay_audits_append_only
  BEFORE UPDATE OR DELETE ON worker_replay_audits
  FOR EACH ROW EXECUTE FUNCTION reject_worker_replay_audit_mutation();

COMMENT ON TABLE simulation_milestones IS
  'Authoritative PostgreSQL schedule for generic idempotent transitions; Redis inventory is never consulted for eligibility.';
COMMENT ON TABLE worker_dead_letters IS
  'Bounded, redacted transport diagnostics only; never authoritative gameplay state.';
