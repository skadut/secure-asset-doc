-- Manual apply (existing DB volume already initialized, init scripts do not rerun):
-- docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/010_red_strict_dual_auth.sql
-- RED+STRICT TLP, security officer role, dual-authorization access requests. Idempotent. Additive only, no data deletion.
BEGIN;

-- 1. Security officer flag and unit label.
ALTER TABLE users ADD COLUMN IF NOT EXISTS security_officer boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS unit text NULL;

-- 2. A commander (level 5) cannot also be a security officer.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_officer_not_l5_check;
ALTER TABLE users ADD CONSTRAINT users_officer_not_l5_check CHECK (NOT (security_officer AND access_level = 5));

-- 3. TLP vocabulary adds RED+STRICT. Constraint name verified in 001_schema.sql (inline CHECK on documents.tlp).
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_tlp_check;
ALTER TABLE documents ADD CONSTRAINT documents_tlp_check CHECK (tlp IN ('CLEAR', 'GREEN', 'AMBER', 'AMBER+STRICT', 'RED', 'RED+STRICT'));

-- 4. Audit vocabulary: 009 list (incl. 'derive') plus access.* actions.
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check
    CHECK (action IN ('create', 'update', 'approve', 'link', 'unlink', 'export', 'delete', 'access.denied', 'purge', 'grant', 'revoke', 'derive', 'access.request', 'access.approve', 'access.deny', 'access.grant', 'access.revoke'));

-- 5. Access requests and approvals. Writes only through request_document_access / decide_access_request.
CREATE TABLE IF NOT EXISTS access_requests (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id text NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
    grantee text NOT NULL REFERENCES users(username) ON UPDATE CASCADE,
    requested_by text NOT NULL REFERENCES users(username) ON UPDATE CASCADE,
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    expires_at timestamptz NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS access_requests_pending_uq ON access_requests (document_id, grantee) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS access_approvals (
    request_id bigint NOT NULL REFERENCES access_requests(id) ON DELETE RESTRICT,
    approver text NOT NULL REFERENCES users(username) ON UPDATE CASCADE,
    role text NOT NULL CHECK (role IN ('commander', 'security_officer')),
    decision text NOT NULL CHECK (decision IN ('approve', 'deny')),
    reason text NULL CHECK (reason IS NULL OR length(reason) <= 500),
    at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (request_id, role),
    UNIQUE (request_id, approver)
);

REVOKE ALL ON access_requests, access_approvals FROM PUBLIC;
GRANT SELECT ON access_requests, access_approvals TO sad_app;

-- 6. Requester side. Any commander or security officer may request; grantee must be active and not the requester.
CREATE OR REPLACE FUNCTION request_document_access(p_actor text, p_document_id text, p_grantee text, p_reason text, p_expires_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reason text := btrim(p_reason);
    v_id bigint;
    v_audit text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.username = p_actor AND u.active AND (u.access_level = 5 OR u.security_officer)) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = p_document_id) THEN
        RAISE EXCEPTION 'document not found' USING ERRCODE = 'P0002';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.username = p_grantee AND u.active) THEN
        RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_reason IS NULL OR length(v_reason) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'invalid reason' USING ERRCODE = '22023';
    END IF;
    IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
        RAISE EXCEPTION 'expiry must be in the future' USING ERRCODE = '22023';
    END IF;
    IF p_grantee = p_actor THEN
        RAISE EXCEPTION 'self-request not allowed' USING ERRCODE = '42501';
    END IF;

    INSERT INTO access_requests (document_id, grantee, requested_by, reason, expires_at)
    VALUES (p_document_id, p_grantee, p_actor, v_reason, p_expires_at)
    RETURNING id INTO v_id;

    v_audit := log_audit(p_actor, 'access.request', 'document', p_document_id,
        format('Requested %s access to %s', p_grantee, p_document_id),
        jsonb_build_object('requestId', v_id, 'grantee', p_grantee, 'expiresAt', p_expires_at));

    RETURN jsonb_build_object('requestId', v_id::text, 'status', 'pending', 'auditId', v_audit);
END;
$$;

-- 7. Approver side. Commander (level 5) and security officer each approve once; grant written only when both approve.
CREATE OR REPLACE FUNCTION decide_access_request(p_actor text, p_request_id bigint, p_decision text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_req access_requests%ROWTYPE;
    v_role text;
    v_approved int;
    v_commander_id uuid;
    v_grantee_id uuid;
    v_approvers jsonb;
    v_audit text;
BEGIN
    SELECT * INTO v_req FROM access_requests WHERE id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'request not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'request is not pending' USING ERRCODE = '55000';
    END IF;
    IF p_decision IS NULL OR p_decision NOT IN ('approve', 'deny') THEN
        RAISE EXCEPTION 'invalid decision' USING ERRCODE = '22023';
    END IF;

    SELECT CASE WHEN u.access_level = 5 THEN 'commander' WHEN u.security_officer THEN 'security_officer' END
      INTO v_role
      FROM users u
     WHERE u.username = p_actor AND u.active;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF p_actor = v_req.requested_by OR p_actor = v_req.grantee THEN
        RAISE EXCEPTION 'requester and grantee cannot approve' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM access_approvals a WHERE a.request_id = p_request_id AND (a.role = v_role OR a.approver = p_actor)) THEN
        RAISE EXCEPTION 'already decided by this role or approver' USING ERRCODE = '23505';
    END IF;

    INSERT INTO access_approvals (request_id, approver, role, decision, reason)
    VALUES (p_request_id, p_actor, v_role, p_decision, NULLIF(btrim(p_reason), ''));

    v_audit := log_audit(p_actor, CASE WHEN p_decision = 'approve' THEN 'access.approve' ELSE 'access.deny' END,
        'document', v_req.document_id,
        format('Access request %s %s by %s (%s)', p_request_id, p_decision, p_actor, v_role),
        jsonb_build_object('requestId', p_request_id, 'role', v_role, 'decision', p_decision));

    IF p_decision = 'deny' THEN
        UPDATE access_requests SET status = 'denied' WHERE id = p_request_id;
        RETURN jsonb_build_object('requestId', p_request_id::text, 'status', 'denied', 'granted', false, 'auditId', v_audit);
    END IF;

    SELECT count(*) INTO v_approved
      FROM access_approvals a
     WHERE a.request_id = p_request_id AND a.decision = 'approve' AND a.role IN ('commander', 'security_officer');

    IF v_approved = 2 THEN
        IF v_req.expires_at IS NOT NULL AND v_req.expires_at <= now() THEN
            RAISE EXCEPTION 'expiry must be in the future' USING ERRCODE = '22023';
        END IF;

        SELECT u.id INTO v_grantee_id FROM users u WHERE u.username = v_req.grantee AND u.active;
        IF v_grantee_id IS NULL THEN
            RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
        END IF;

        SELECT u.id INTO v_commander_id
          FROM access_approvals a
          JOIN users u ON u.username = a.approver
         WHERE a.request_id = p_request_id AND a.role = 'commander' AND a.decision = 'approve';

        SELECT jsonb_agg(a.approver ORDER BY a.role) INTO v_approvers
          FROM access_approvals a
         WHERE a.request_id = p_request_id AND a.decision = 'approve';

        INSERT INTO document_access_grants (document_id, user_id, granted_by, granted_at, expires_at)
        VALUES (v_req.document_id, v_grantee_id, v_commander_id, now(), v_req.expires_at)
        ON CONFLICT (document_id, user_id) DO UPDATE
           SET granted_by = EXCLUDED.granted_by,
               granted_at = now(),
               expires_at = EXCLUDED.expires_at,
               revoked_at = NULL,
               revoked_by = NULL;

        UPDATE access_requests SET status = 'approved' WHERE id = p_request_id;

        v_audit := log_audit(p_actor, 'grant', 'document', v_req.document_id,
            format('Granted %s access to %s', v_req.grantee, v_req.document_id),
            jsonb_build_object('username', v_req.grantee, 'expiresAt', v_req.expires_at, 'requestId', p_request_id, 'approvers', v_approvers));

        RETURN jsonb_build_object('requestId', p_request_id::text, 'status', 'approved', 'granted', true, 'auditId', v_audit);
    END IF;

    RETURN jsonb_build_object('requestId', p_request_id::text, 'status', 'pending', 'granted', false, 'auditId', v_audit);
END;
$$;

REVOKE ALL ON FUNCTION request_document_access(text, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_document_access(text, text, text, text, timestamptz) TO sad_app;
REVOKE ALL ON FUNCTION decide_access_request(text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decide_access_request(text, bigint, text, text) TO sad_app;

-- 8. Revoke: commander or security officer, single person, immediate. Body otherwise as in 008.
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
    SELECT u.id INTO v_actor_id FROM users u WHERE u.username = p_actor AND u.active AND (u.access_level = 5 OR u.security_officer);
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

-- 9. Direct grant by level 5 is no longer callable by the app role. Function kept for admin seeds; body unchanged.
REVOKE EXECUTE ON FUNCTION grant_document_access(text, text, text, timestamptz) FROM sad_app;

-- 10. derive_document: RED+STRICT is the strictest TLP, rank 5 (above RED = 4).
CREATE OR REPLACE FUNCTION derive_document(p_actor text, p_parent_id text, p_title text, p_tlp text, p_summary text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id uuid;
    v_username text;
    v_access_level smallint;
    v_parent_tlp text;
    v_id text;
    v_audit text;
BEGIN
    SELECT id, username, access_level
      INTO v_actor_id, v_username, v_access_level
      FROM users
     WHERE username = p_actor AND active AND access_level = 5;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'invalid title' USING ERRCODE = '22023';
    END IF;
    IF p_summary IS NULL OR length(btrim(p_summary)) NOT BETWEEN 1 AND 4000 THEN
        RAISE EXCEPTION 'invalid summary' USING ERRCODE = '22023';
    END IF;
    IF p_tlp IS NULL OR p_tlp NOT IN ('CLEAR', 'GREEN', 'AMBER', 'AMBER+STRICT', 'RED', 'RED+STRICT') THEN
        RAISE EXCEPTION 'invalid TLP' USING ERRCODE = '22023';
    END IF;

    SELECT tlp INTO v_parent_tlp FROM documents WHERE id = p_parent_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'parent document not found' USING ERRCODE = 'P0002';
    END IF;
    IF (CASE p_tlp
            WHEN 'CLEAR' THEN 0
            WHEN 'GREEN' THEN 1
            WHEN 'AMBER' THEN 2
            WHEN 'AMBER+STRICT' THEN 3
            WHEN 'RED' THEN 4
            WHEN 'RED+STRICT' THEN 5
        END) >=
       (CASE v_parent_tlp
            WHEN 'CLEAR' THEN 0
            WHEN 'GREEN' THEN 1
            WHEN 'AMBER' THEN 2
            WHEN 'AMBER+STRICT' THEN 3
            WHEN 'RED' THEN 4
            WHEN 'RED+STRICT' THEN 5
        END) THEN
        RAISE EXCEPTION 'derived TLP must be lower than parent TLP' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('derive_document'));
    SELECT 'DOC-' || lpad((COALESCE(MAX(substring(id from 5)::int), 0) + 1)::text, 4, '0')
      INTO v_id
      FROM documents
     WHERE id ~ '^DOC-[0-9]{4}$';

    INSERT INTO documents (id, title, type, tlp, status, owner, approver, next_review, derived_from)
    VALUES (v_id, btrim(p_title), 'Procedure', p_tlp, 'draft', p_actor, p_actor, CURRENT_DATE, p_parent_id);

    INSERT INTO document_versions (document_id, version, date, author, summary, file_name, mime_type, size_bytes, sha256, content_base64, protection, content_ciphertext, integrity_tag)
    VALUES (v_id, '1.0', CURRENT_DATE, p_actor, btrim(p_summary), NULL, NULL, NULL, NULL, NULL, 'none', NULL, NULL);

    v_audit := log_audit(p_actor, 'derive', 'document', v_id,
        'Derived ' || v_id || ' from ' || p_parent_id,
        jsonb_build_object('parent', p_parent_id, 'tlp', p_tlp));

    RETURN jsonb_build_object('documentId', v_id, 'auditId', v_audit, 'derivedFrom', p_parent_id);
END;
$$;

REVOKE ALL ON FUNCTION derive_document(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derive_document(text, text, text, text, text) TO sad_app;

COMMIT;
