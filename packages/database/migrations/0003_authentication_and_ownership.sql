-- Better Auth 1.6.23 schema input was generated with `auth generate`, reviewed,
-- and incorporated here. Better Auth never runs migrations in production.
CREATE TABLE auth_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE auth_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "expiresAt" timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" uuid NOT NULL REFERENCES auth_user (id) ON DELETE CASCADE
);
CREATE INDEX auth_session_user_id_idx ON auth_session ("userId");
CREATE INDEX auth_session_expiry_idx ON auth_session ("expiresAt");

CREATE TABLE auth_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" uuid NOT NULL REFERENCES auth_user (id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL,
  UNIQUE ("providerId", "accountId")
);
CREATE INDEX auth_account_user_id_idx ON auth_account ("userId");

CREATE TABLE auth_verification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX auth_verification_identifier_idx ON auth_verification (identifier);
CREATE INDEX auth_verification_expiry_idx ON auth_verification ("expiresAt");

CREATE TABLE player_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authentication_user_id uuid NOT NULL UNIQUE REFERENCES auth_user (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE player_account_roles (
  player_account_id uuid NOT NULL REFERENCES player_accounts (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('player', 'administrator')),
  granted_by_player_account_id uuid REFERENCES player_accounts (id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (player_account_id, role)
);

CREATE TABLE resource_ownerships (
  resource_type text NOT NULL CHECK (resource_type <> ''),
  resource_id uuid NOT NULL,
  player_account_id uuid NOT NULL REFERENCES player_accounts (id) ON DELETE RESTRICT,
  bound_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (resource_type, resource_id)
);
CREATE INDEX resource_ownerships_player_resource_idx
  ON resource_ownerships (player_account_id, resource_type, resource_id);

CREATE TABLE security_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type <> ''),
  authentication_user_id uuid REFERENCES auth_user (id) ON DELETE SET NULL,
  player_account_id uuid REFERENCES player_accounts (id) ON DELETE SET NULL,
  request_id text,
  target_type text NOT NULL CHECK (target_type <> ''),
  target_identifier text NOT NULL CHECK (target_identifier <> ''),
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'denied', 'failed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX security_audit_events_actor_time_idx
  ON security_audit_events (player_account_id, occurred_at DESC);
CREATE INDEX security_audit_events_target_time_idx
  ON security_audit_events (target_type, target_identifier, occurred_at DESC);

CREATE FUNCTION create_player_account_for_auth_user() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  new_player_account_id uuid;
BEGIN
  INSERT INTO player_accounts (authentication_user_id)
  VALUES (NEW.id)
  RETURNING id INTO new_player_account_id;

  INSERT INTO player_account_roles (player_account_id, role)
  VALUES (new_player_account_id, 'player');
  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_user_create_player_account
  AFTER INSERT ON auth_user
  FOR EACH ROW EXECUTE FUNCTION create_player_account_for_auth_user();

CREATE FUNCTION reject_security_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'security audit events are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER security_audit_events_append_only
  BEFORE UPDATE OR DELETE ON security_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_security_audit_mutation();

COMMENT ON TABLE resource_ownerships IS
  'Opaque ownership bindings. Ticket 08 inserts the airline and its ownership row in one transaction.';
COMMENT ON TABLE security_audit_events IS
  'Append-only security events. Metadata must never contain credentials, tokens, or session material.';
