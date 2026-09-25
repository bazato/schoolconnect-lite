\connect schoolconnect_identity

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 varchar(20) NOT NULL UNIQUE,
  display_name varchar(150) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  school_id uuid,
  role varchar(30) NOT NULL CHECK (role IN ('PLATFORM_OWNER', 'SCHOOL_ADMIN', 'TEACHER', 'PARENT')),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'PLATFORM_OWNER' AND school_id IS NULL) OR (role <> 'PLATFORM_OWNER' AND school_id IS NOT NULL)),
  UNIQUE (user_id, school_id, role)
);
CREATE INDEX memberships_school_role_idx ON memberships (school_id, role, status);
CREATE UNIQUE INDEX memberships_platform_owner_user_idx ON memberships (user_id, role) WHERE role = 'PLATFORM_OWNER';

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid,
  invitation_code_hash varchar(128) NOT NULL UNIQUE,
  phone_hash varchar(128),
  role varchar(30) NOT NULL CHECK (role IN ('PLATFORM_OWNER', 'SCHOOL_ADMIN', 'TEACHER', 'PARENT')),
  CHECK ((role = 'PLATFORM_OWNER' AND school_id IS NULL) OR (role <> 'PLATFORM_OWNER' AND school_id IS NOT NULL)),
  expires_at timestamptz NOT NULL,
  accepted_by_user_id uuid REFERENCES users(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid REFERENCES memberships(id),
  phone_hash varchar(128) NOT NULL,
  code_hash varchar(128) NOT NULL,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts smallint NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenges_lookup_idx ON otp_challenges (phone_hash, expires_at DESC);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  device_id varchar(200) NOT NULL,
  token_family_id uuid NOT NULL,
  refresh_token_hash varchar(128) NOT NULL,
  expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token_family_id, refresh_token_hash)
);
CREATE INDEX auth_sessions_active_idx ON auth_sessions (user_id, revoked_at, expires_at);

CREATE TABLE idempotency_keys (
  actor_id uuid NOT NULL,
  operation varchar(80) NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(128) NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, operation, idempotency_key)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(120) NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0
);
CREATE INDEX identity_outbox_pending_idx ON outbox_events (available_at, occurred_at) WHERE processed_at IS NULL;
