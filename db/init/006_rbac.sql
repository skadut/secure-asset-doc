-- RBAC: ranks, users, sessions, audit writer, least-privilege grants.
-- Runs after 005_app_role.sh in fresh init (alphabetical), so role sad_app exists.
-- On live DB, apply manually as admin (POSTGRES_USER). Grants live here, not in 005,
-- because 005 only runs on a fresh pgdata volume.
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP CONSTRAINT IF EXISTS + re-ADD. Ranks rows: db/seed/001_reference.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS ranks (
    code text PRIMARY KEY,
    name text UNIQUE NOT NULL,
    golongan text NOT NULL,
    tlp_max text NOT NULL CHECK (tlp_max IN ('CLEAR', 'GREEN', 'AMBER', 'AMBER+STRICT', 'RED')),
    sort int NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text UNIQUE NOT NULL CHECK (username ~ '^[a-z0-9.-]{3,40}$'),
    name text NOT NULL,
    rank_code text NOT NULL REFERENCES ranks(code),
    owner_label text NULL,
    password_hash text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS uploaded_by uuid NULL REFERENCES users(id) ON DELETE SET NULL;

-- Extend audit vocabulary. Existing values kept. Constraint names verified on live DB.
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check
    CHECK (action IN ('create', 'update', 'approve', 'link', 'unlink', 'export', 'delete', 'access.denied', 'purge', 'grant', 'revoke'));

ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_object_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_object_type_check
    CHECK (object_type IN ('asset', 'document', 'evidence', 'upload', 'user', 'audit'));

-- SECURITY DEFINER writer: sad_app appends audit rows without INSERT on audit_events.
-- Owner must be the audit_events owner (POSTGRES_USER) so it bypasses sad_app's missing INSERT grant.
CREATE OR REPLACE FUNCTION log_audit(p_actor text, p_action text, p_object_type text, p_object_id text, p_summary text, p_changes jsonb DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id text := 'AUD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
BEGIN
    INSERT INTO audit_events (id, at, actor, action, object_type, object_id, summary, changes)
    VALUES (v_id, now(), p_actor, p_action, p_object_type, p_object_id, p_summary, p_changes);
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION log_audit(text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_audit(text, text, text, text, text, jsonb) TO sad_app;

CREATE OR REPLACE FUNCTION log_access_denied(p_actor text, p_object_type text, p_object_id text, p_summary text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN log_audit(p_actor, 'access.denied', p_object_type, p_object_id, p_summary, NULL);
END;
$$;

REVOKE ALL ON FUNCTION log_access_denied(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_access_denied(text, text, text, text) TO sad_app;

-- Least-privilege grants for sad_app. audit_events: SELECT only (from 005). No UPDATE/DELETE/TRUNCATE/INSERT.
GRANT SELECT ON ranks TO sad_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions TO sad_app;
GRANT INSERT, UPDATE, DELETE ON documents, document_versions, assets TO sad_app;
GRANT INSERT, DELETE ON asset_document_links, evidence_links TO sad_app;
GRANT DELETE ON uploaded_files TO sad_app;
GRANT UPDATE (name) ON uploaded_files TO sad_app;

COMMIT;
