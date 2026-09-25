-- Development-only Platform Owner. Production bootstrap must use an offline, audited operator procedure.
\connect schoolconnect_identity

INSERT INTO users (id, phone_e164, display_name)
VALUES ('10000000-0000-4000-8000-000000000000', '+919876543200', 'Platform Owner')
ON CONFLICT DO NOTHING;

INSERT INTO memberships (id, user_id, school_id, role)
VALUES ('11000000-0000-4000-8000-000000000000', '10000000-0000-4000-8000-000000000000', NULL, 'PLATFORM_OWNER')
ON CONFLICT DO NOTHING;

INSERT INTO invitations (id, school_id, invitation_code_hash, phone_hash, role, expires_at)
VALUES ('12000000-0000-4000-8000-000000000000', NULL, encode(digest('OWNER-INVITE', 'sha256'), 'hex'), encode(digest('+919876543200', 'sha256'), 'hex'), 'PLATFORM_OWNER', '2035-01-01')
ON CONFLICT DO NOTHING;
