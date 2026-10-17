\connect schoolconnect_files

ALTER TABLE file_objects
  ADD COLUMN stored_byte_size bigint CHECK(stored_byte_size>0),
  ADD COLUMN stored_checksum_sha256 char(64),
  ADD COLUMN compression_method varchar(50);

-- Retain attestations for already checked, unchanged objects; do not invent scan results.
UPDATE file_objects SET stored_byte_size=byte_size,stored_checksum_sha256=verified_checksum_sha256,
  compression_method='original'
WHERE processing_status='READY' AND scanned_at IS NOT NULL
  AND scanner_version IS NOT NULL AND verified_checksum_sha256=checksum_sha256;
