-- Manual apply (existing DB volume already initialized, init scripts do not rerun):
-- docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/013_login_lockout.sql
-- Login lockout (AC-7), last-sign-in tracking (AC-9), session idle tracking, audit vocabulary for login/logout. Idempotent. Additive only, no data deletion.
-- Grants: none added. sad_app already has SELECT, INSERT, UPDATE, DELETE on users and sessions (006), which covers the new columns.
BEGIN;

-- 1. Lockout and sign-in state on the account. Counters live in the DB, not in memory.
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_since_last int NOT NULL DEFAULT 0;

-- 2. Idle tracking for sessions (5 min idle lock, enforced in backend/session.mjs).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen timestamptz NOT NULL DEFAULT now();

-- 3. Audit vocabulary: 011 list plus login.* and logout. Full list copied verbatim from 011.
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check
    CHECK (action IN ('create', 'update', 'approve', 'link', 'unlink', 'export', 'delete', 'access.denied', 'purge', 'grant', 'revoke', 'derive', 'access.request', 'access.approve', 'access.deny', 'access.grant', 'access.revoke', 'level.request', 'level.approve', 'level.deny', 'level.apply', 'level.lowered', 'login.password.fail', 'login.code.fail', 'login.locked', 'login.success', 'logout'));

COMMIT;
