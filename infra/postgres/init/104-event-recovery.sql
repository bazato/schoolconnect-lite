-- Transport ownership stays local: no cross-database foreign keys or worker service.
\connect schoolconnect_identity
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS claim_token uuid;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_error_code varchar(100);

\connect schoolconnect_school
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS claim_token uuid;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_error_code varchar(100);

\connect schoolconnect_content
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS claim_token uuid;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_error_code varchar(100);

\connect schoolconnect_attendance
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS claim_token uuid;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_error_code varchar(100);

\connect schoolconnect_files
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS claim_token uuid;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_error_code varchar(100);

\connect schoolconnect_notifications
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS claim_token uuid;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_error_code varchar(100);

\connect schoolconnect_fees
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS claim_token uuid;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_error_code varchar(100);

\connect schoolconnect_notifications
CREATE TABLE IF NOT EXISTS consumer_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_group varchar(100) NOT NULL,
  topic varchar(249) NOT NULL,
  partition_id integer NOT NULL CHECK (partition_id>=0),
  kafka_offset bigint NOT NULL CHECK (kafka_offset>=0),
  raw_value bytea,
  raw_key bytea,
  event_id varchar(128),
  event_type varchar(120),
  school_id uuid,
  state varchar(20) NOT NULL DEFAULT 'QUARANTINED' CHECK (state IN ('QUARANTINED','REPLAYING','RESOLVED')),
  error_code varchar(100) NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count>0),
  replay_count integer NOT NULL DEFAULT 0,
  replay_token uuid,
  replay_lease_until timestamptz,
  replayed_by_user_id uuid,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (consumer_group,topic,partition_id,kafka_offset)
);
CREATE INDEX IF NOT EXISTS consumer_failures_state_idx ON consumer_failures (consumer_group,state,last_failed_at DESC);

\connect schoolconnect_audit
CREATE TABLE IF NOT EXISTS consumer_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_group varchar(100) NOT NULL,
  topic varchar(249) NOT NULL,
  partition_id integer NOT NULL CHECK (partition_id>=0),
  kafka_offset bigint NOT NULL CHECK (kafka_offset>=0),
  raw_value bytea,
  raw_key bytea,
  event_id varchar(128),
  event_type varchar(120),
  school_id uuid,
  state varchar(20) NOT NULL DEFAULT 'QUARANTINED' CHECK (state IN ('QUARANTINED','REPLAYING','RESOLVED')),
  error_code varchar(100) NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count>0),
  replay_count integer NOT NULL DEFAULT 0,
  replay_token uuid,
  replay_lease_until timestamptz,
  replayed_by_user_id uuid,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (consumer_group,topic,partition_id,kafka_offset)
);
CREATE INDEX IF NOT EXISTS consumer_failures_state_idx ON consumer_failures (consumer_group,state,last_failed_at DESC);

\connect schoolconnect_read
-- Archive facts survive even if their original post event was quarantined.
ALTER TABLE consumed_events ADD COLUMN IF NOT EXISTS aggregate_id uuid;
ALTER TABLE consumed_events ADD COLUMN IF NOT EXISTS school_id uuid;
CREATE INDEX IF NOT EXISTS consumed_events_aggregate_idx ON consumed_events (school_id,aggregate_id,event_type);
CREATE TABLE IF NOT EXISTS consumer_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_group varchar(100) NOT NULL,
  topic varchar(249) NOT NULL,
  partition_id integer NOT NULL CHECK (partition_id>=0),
  kafka_offset bigint NOT NULL CHECK (kafka_offset>=0),
  raw_value bytea,
  raw_key bytea,
  event_id varchar(128),
  event_type varchar(120),
  school_id uuid,
  state varchar(20) NOT NULL DEFAULT 'QUARANTINED' CHECK (state IN ('QUARANTINED','REPLAYING','RESOLVED')),
  error_code varchar(100) NOT NULL,
  attempt_count integer NOT NULL CHECK (attempt_count>0),
  replay_count integer NOT NULL DEFAULT 0,
  replay_token uuid,
  replay_lease_until timestamptz,
  replayed_by_user_id uuid,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (consumer_group,topic,partition_id,kafka_offset)
);
CREATE INDEX IF NOT EXISTS consumer_failures_state_idx ON consumer_failures (consumer_group,state,last_failed_at DESC);
