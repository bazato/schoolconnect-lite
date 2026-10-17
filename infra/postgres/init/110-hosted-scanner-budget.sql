\connect schoolconnect_files

CREATE TABLE scanner_provider_state (
  provider varchar(40) PRIMARY KEY,
  lease_token uuid,
  lease_until timestamptz,
  last_request_at timestamptz,
  health_checked_at timestamptz,
  health_key_fingerprint char(64)
);
INSERT INTO scanner_provider_state(provider) VALUES('cloudmersive');
CREATE TABLE scanner_requests (
  id uuid PRIMARY KEY,
  provider varchar(40) NOT NULL REFERENCES scanner_provider_state(provider),
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scanner_requests_window_idx ON scanner_requests(provider,requested_at DESC);
