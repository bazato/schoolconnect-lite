\connect schoolconnect_content

-- Preserve the original request trace until a scheduled post is published.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS created_correlation_id text;

\connect schoolconnect_audit

-- Correlation IDs from a trusted gateway may be UUIDs or bounded client trace
-- strings; they are diagnostic labels, not database entity IDs.
ALTER TABLE audit_events ALTER COLUMN correlation_id TYPE varchar(128) USING correlation_id::text;
