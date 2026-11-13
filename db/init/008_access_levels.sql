-- Access levels (users.access_level 1-5) + per-document grants.
-- Apply manually on live DB as admin (POSTGRES_USER). Idempotent: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- DROP CONSTRAINT IF EXISTS + re-ADD, CREATE OR REPLACE FUNCTION, REVOKE/GRANT.
-- Schema only. Levels per rank and DOC-0017 grants are seeded by db/scripts/seed-users.mjs; DOC-0017 TLP AMBER+STRICT comes from db/seed/002_seed.sql.
-- Additive only: no DELETE/TRUNCATE/DROP of data. Revoke is soft (revoked_at). Grant rows are never deleted.
BEGIN;

-- 1. Level per user. Inline CHECK is auto-named users_access_level_check. ADD COLUMN IF NOT EXISTS skips it on re-run.
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_level smallint NOT NULL DEFAULT 1 CHECK (access_level BETWEEN 1 AND 5);

-- 4. Per-document grants. No row is ever deleted. Active = revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()).
CREATE TABLE IF NOT EXISTS document_access_grants (
  document_id text NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  revoked_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (document_id, user_id)
);

-- 5. Audit vocabulary. object_type list unchanged from 006/007.
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check
    CHECK (action IN ('create', 'update', 'approve', 'link', 'unlink', 'export', 'delete', 'access.denied', 'purge', 'grant', 'revoke'));

ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_object_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_object_type_check
    CHECK (object_type IN ('asset', 'document', 'evidence', 'upload', 'user', 'audit'));

-- 6. SECURITY DEFINER writers. sad_app has no direct INSERT/UPDATE on document_access_grants.
CREATE OR REPLACE FUNCTION grant_document_access(p_actor text, p_document_id text, p_username text, p_expires_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id uuid;
    v_user_id uuid;
    v_audit text;
BEGIN
    SELECT u.id INTO v_actor_id FROM users u WHERE u.username = p_actor AND u.active AND u.access_level = 5;
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = p_document_id) THEN
        RAISE EXCEPTION 'document not found' USING ERRCODE = 'P0002';
    END IF;
    SELECT u.id INTO v_user_id FROM users u WHERE u.username = p_username AND u.active;
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
    END IF;
    IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
        RAISE EXCEPTION 'expiry must be in the future' USING ERRCODE = '22023';
    END IF;

    INSERT INTO document_access_grants (document_id, user_id, granted_by, granted_at, expires_at)
    VALUES (p_document_id, v_user_id, v_actor_id, now(), p_expires_at)
    ON CONFLICT (document_id, user_id) DO UPDATE
       SET granted_by = EXCLUDED.granted_by,
           granted_at = now(),
           expires_at = EXCLUDED.expires_at,
           revoked_at = NULL,
           revoked_by = NULL;

    v_audit := log_audit(p_actor, 'grant', 'document', p_document_id,
        format('Granted %s access to %s', p_username, p_document_id),
        jsonb_build_object('username', p_username, 'expiresAt', p_expires_at));

    RETURN jsonb_build_object('username', p_username, 'expiresAt', p_expires_at, 'auditId', v_audit);
END;
$$;

REVOKE ALL ON FUNCTION grant_document_access(text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grant_document_access(text, text, text, timestamptz) TO sad_app;

CREATE OR REPLACE FUNCTION revoke_document_access(p_actor text, p_document_id text, p_username text) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id uuid;
    v_user_id uuid;
    v_audit text;
BEGIN
    SELECT u.id INTO v_actor_id FROM users u WHERE u.username = p_actor AND u.active AND u.access_level = 5;
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    SELECT u.id INTO v_user_id FROM users u WHERE u.username = p_username;

    UPDATE document_access_grants g
       SET revoked_at = now(), revoked_by = v_actor_id
     WHERE g.document_id = p_document_id AND g.user_id = v_user_id AND g.revoked_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'grant not found' USING ERRCODE = 'P0002';
    END IF;

    v_audit := log_audit(p_actor, 'revoke', 'document', p_document_id,
        format('Revoked %s access to %s', p_username, p_document_id),
        jsonb_build_object('username', p_username));

    RETURN jsonb_build_object('username', p_username, 'auditId', v_audit);
END;
$$;

REVOKE ALL ON FUNCTION revoke_document_access(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_document_access(text, text, text) TO sad_app;

-- 7. Grants. Writes only through the functions above.
REVOKE ALL ON document_access_grants FROM PUBLIC;
GRANT SELECT ON document_access_grants TO sad_app;

COMMIT;
