\connect schoolconnect_notifications

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE notification_preferences (
  user_id uuid NOT NULL,
  school_id uuid NOT NULL,
  push_enabled boolean NOT NULL DEFAULT true,
  quiet_hours_start time,
  quiet_hours_end time,
  timezone varchar(80) NOT NULL DEFAULT 'UTC',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, school_id)
);

CREATE TABLE device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_id varchar(200) NOT NULL,
  platform varchar(20) NOT NULL CHECK (platform IN ('IOS', 'ANDROID')),
  provider_token text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INVALID', 'REVOKED')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, provider_token)
);
CREATE INDEX device_tokens_user_idx ON device_tokens (user_id, status);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_event_id uuid NOT NULL,
  school_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  student_id uuid,
  notification_type varchar(80) NOT NULL,
  resource_type varchar(50) NOT NULL,
  resource_id uuid NOT NULL,
  title varchar(200) NOT NULL,
  body varchar(500) NOT NULL,
  deep_link varchar(500) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'PROVIDER_ACCEPTED', 'PROVIDER_REJECTED', 'UNKNOWN')),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_event_id, recipient_user_id)
);
CREATE INDEX notifications_inbox_idx ON notifications (school_id, recipient_user_id, created_at DESC);

CREATE TABLE delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id),
  provider varchar(50) NOT NULL,
  provider_message_id varchar(200),
  status varchar(30) NOT NULL CHECK (status IN ('ACCEPTED', 'REJECTED', 'UNKNOWN')),
  error_code varchar(100),
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_attempts_notification_idx ON delivery_attempts (notification_id, attempted_at DESC);

CREATE TABLE consumed_events (
  event_id uuid NOT NULL,
  consumer_name varchar(100) NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, consumer_name)
);
