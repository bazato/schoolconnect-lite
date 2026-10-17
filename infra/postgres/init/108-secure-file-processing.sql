\connect schoolconnect_files

ALTER TABLE file_objects
  ADD COLUMN processing_token uuid,
  ADD COLUMN processing_lease_until timestamptz,
  ADD COLUMN processing_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN processing_error varchar(80),
  ADD COLUMN verified_checksum_sha256 char(64),
  ADD COLUMN scanner_version varchar(200),
  ADD COLUMN scanned_at timestamptz,
  ADD COLUMN storage_reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (storage_reserved_bytes >= 0),
  ADD COLUMN quarantine_purged_at timestamptz;

-- Account for existing objects, including legacy files that have no scan attestation.
UPDATE file_objects SET storage_reserved_bytes = CASE
  WHEN processing_status='DELETED' THEN 0
  WHEN processing_status='READY' THEN byte_size * 2
  ELSE byte_size * 2 END;
CREATE INDEX files_processing_lease_idx ON file_objects(processing_lease_until)
  WHERE processing_status='SCANNING';
CREATE INDEX files_cleanup_idx ON file_objects(created_at)
  WHERE quarantine_purged_at IS NULL;
CREATE INDEX files_reserved_school_idx ON file_objects(school_id)
  INCLUDE(storage_reserved_bytes) WHERE storage_reserved_bytes>0;
