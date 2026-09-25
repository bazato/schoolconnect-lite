\connect schoolconnect_audit

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_id uuid,
  school_id uuid NOT NULL,
  actor_user_id uuid,
  actor_membership_id uuid,
  action varchar(120) NOT NULL,
  resource_type varchar(80) NOT NULL,
  resource_id uuid NOT NULL,
  outcome varchar(20) NOT NULL CHECK (outcome IN ('SUCCEEDED', 'DENIED', 'FAILED')),
  correlation_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_event_id, action)
);
CREATE INDEX audit_events_school_time_idx ON audit_events (school_id, occurred_at DESC);
CREATE INDEX audit_events_resource_idx ON audit_events (resource_type, resource_id, occurred_at DESC);

CREATE TABLE consumer_checkpoints (
  consumer_name varchar(100) PRIMARY KEY,
  last_event_id uuid,
  last_processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
