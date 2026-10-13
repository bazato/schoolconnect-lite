\connect schoolconnect_fees
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS fee_ledger_state (
  school_id uuid PRIMARY KEY, revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
CREATE TABLE IF NOT EXISTS fee_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, student_id uuid NOT NULL,
  admission_number varchar(120) NOT NULL, student_name varchar(200) NOT NULL,
  fee_reference varchar(120) NOT NULL, academic_year varchar(40) NOT NULL,
  due_date date NOT NULL, amount_minor bigint NOT NULL CHECK (amount_minor > 0), currency char(3) NOT NULL,
  description varchar(300) NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, student_id, fee_reference), UNIQUE (school_id, id)
);
CREATE INDEX IF NOT EXISTS fee_invoices_school_due_idx ON fee_invoices(school_id,due_date,student_id);
CREATE TABLE IF NOT EXISTS fee_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL, invoice_id uuid NOT NULL,
  collection_reference varchar(120) NOT NULL, collection_date date NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, invoice_id) REFERENCES fee_invoices(school_id,id),
  UNIQUE (school_id, collection_reference)
);
CREATE INDEX IF NOT EXISTS fee_collections_school_date_idx ON fee_collections(school_id,collection_date,invoice_id);
CREATE TABLE IF NOT EXISTS fee_import_batches (
  school_id uuid NOT NULL, batch_id uuid NOT NULL, actor_user_id uuid NOT NULL,
  payload_hash char(64) NOT NULL, result jsonb NOT NULL, changes jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(school_id,batch_id)
);
CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type varchar(120) NOT NULL, aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(), attempt_count integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS fees_outbox_pending_idx ON outbox_events(available_at,occurred_at) WHERE processed_at IS NULL;
