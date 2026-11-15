-- Migration 0017: add audit_package_built to the auth_event_type enum.
-- IF NOT EXISTS is safe to re-run; Postgres 9.6+ supports it for ADD VALUE.
ALTER TYPE auth_event_type ADD VALUE IF NOT EXISTS 'audit_package_built';
