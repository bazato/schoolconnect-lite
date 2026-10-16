\connect schoolconnect_identity
-- Hash remains the verifier; ciphertext is only exposed to authorized administrators.
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS code_ciphertext text;
CREATE INDEX IF NOT EXISTS invitations_member_latest_idx ON invitations(school_id,role,phone_hash,created_at DESC,id DESC);

\connect schoolconnect_school
CREATE TABLE IF NOT EXISTS identity_membership_events (
  event_id uuid PRIMARY KEY,
  membership_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS guardian_identity_aliases (
  school_id uuid NOT NULL REFERENCES schools(id),
  student_id uuid NOT NULL REFERENCES students(id),
  current_user_id uuid NOT NULL,
  previous_user_id uuid NOT NULL,
  PRIMARY KEY(school_id,student_id,current_user_id,previous_user_id)
);
CREATE TABLE IF NOT EXISTS consumer_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), consumer_group varchar(100) NOT NULL,
  topic varchar(249) NOT NULL, partition_id integer NOT NULL CHECK (partition_id>=0),
  kafka_offset bigint NOT NULL CHECK (kafka_offset>=0), raw_value bytea, raw_key bytea,
  event_id varchar(128), event_type varchar(120), school_id uuid,
  state varchar(20) NOT NULL DEFAULT 'QUARANTINED' CHECK (state IN ('QUARANTINED','REPLAYING','RESOLVED')),
  error_code varchar(100) NOT NULL, attempt_count integer NOT NULL CHECK (attempt_count>0),
  replay_count integer NOT NULL DEFAULT 0, replay_token uuid, replay_lease_until timestamptz,
  replayed_by_user_id uuid, first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  UNIQUE (consumer_group,topic,partition_id,kafka_offset)
);
CREATE INDEX IF NOT EXISTS consumer_failures_state_idx ON consumer_failures (consumer_group,state,last_failed_at DESC);
