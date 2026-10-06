\connect schoolconnect_notifications

-- DELIVERED means stored in the in-app inbox, not delivered to a device.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_status_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_status_check
  CHECK (status IN ('QUEUED', 'DELIVERED', 'FAILED', 'PROVIDER_ACCEPTED', 'PROVIDER_REJECTED', 'UNKNOWN'));
UPDATE notifications SET status='DELIVERED' WHERE status='QUEUED';

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(120) NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS notifications_outbox_pending_idx
  ON outbox_events (available_at, occurred_at) WHERE processed_at IS NULL;
