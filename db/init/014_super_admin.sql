-- Manual apply (existing DB volume already initialized, init scripts do not rerun):
-- docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/014_super_admin.sql
-- Super admin flag. Eligible for either approval slot, never both on one request. Idempotent. Additive only. Apply 014 before deploying the backend that reads users.super_admin.
BEGIN;

-- 1. Super admin flag. Seed sets the value.
ALTER TABLE users ADD COLUMN IF NOT EXISTS super_admin boolean NOT NULL DEFAULT false;

-- 1b. Super admin is never a security officer.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_super_admin_not_officer_check;
ALTER TABLE users ADD CONSTRAINT users_super_admin_not_officer_check CHECK (NOT (super_admin AND security_officer));

-- 1c. Super admin is always level 5.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_super_admin_level5_check;
ALTER TABLE users ADD CONSTRAINT users_super_admin_level5_check CHECK (NOT super_admin OR access_level = 5);

-- 2. Approver side. Super admin (level 5) takes the commander slot first, then the security officer slot. Body otherwise as in 010.
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

    SELECT CASE
             WHEN u.super_admin AND u.access_level = 5 THEN
               CASE WHEN EXISTS (SELECT 1 FROM access_approvals a WHERE a.request_id = p_request_id AND a.role = 'commander')
                     AND NOT EXISTS (SELECT 1 FROM access_approvals a WHERE a.request_id = p_request_id AND a.role = 'security_officer')
                    THEN 'security_officer' ELSE 'commander' END
             WHEN u.access_level = 5 THEN 'commander'
             WHEN u.security_officer THEN 'security_officer'
           END
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

REVOKE ALL ON FUNCTION decide_access_request(text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decide_access_request(text, bigint, text, text) TO sad_app;

-- 3. Requester side: super admin may propose a raise for another user. Body otherwise as in 011.
CREATE OR REPLACE FUNCTION request_level_change(p_actor text, p_target text, p_new_level int, p_justification text, p_screening_verified boolean, p_screening_ref text, p_agreement_signed boolean, p_agreement_date date, p_review_due date, p_fips199_basis text) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target users%ROWTYPE;
    v_just text := btrim(p_justification);
    v_id bigint;
    v_audit text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.username = p_actor AND u.active
                   AND ((u.security_officer AND u.access_level <> 5) OR (u.super_admin AND u.access_level = 5))) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF p_actor = p_target THEN
        RAISE EXCEPTION 'self-change not allowed' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_target FROM users u WHERE u.username = p_target AND u.active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
    END IF;
    IF p_new_level IS NULL OR p_new_level NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'invalid level' USING ERRCODE = '22023';
    END IF;
    IF p_new_level <= v_target.access_level THEN
        RAISE EXCEPTION 'raise only, use lower_user_level to lower' USING ERRCODE = '22023';
    END IF;
    IF p_new_level = 5 AND v_target.security_officer THEN
        RAISE EXCEPTION 'security officer cannot be level 5' USING ERRCODE = '22023';
    END IF;
    -- FIPS 199 basis must match level: 1-2 LOW, 3 MODERATE, 4-5 HIGH. COALESCE: NULL basis must not pass.
    IF NOT COALESCE((p_new_level IN (1, 2) AND p_fips199_basis = 'LOW')
                 OR (p_new_level = 3 AND p_fips199_basis = 'MODERATE')
                 OR (p_new_level IN (4, 5) AND p_fips199_basis = 'HIGH'), false) THEN
        RAISE EXCEPTION 'FIPS 199 basis does not match level' USING ERRCODE = '22023';
    END IF;
    IF p_screening_verified IS NOT TRUE OR p_screening_ref IS NULL OR length(btrim(p_screening_ref)) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'screening required (PS-3)' USING ERRCODE = '22023';
    END IF;
    IF p_agreement_signed IS NOT TRUE OR p_agreement_date IS NULL OR p_agreement_date > current_date THEN
        RAISE EXCEPTION 'access agreement required (PS-6)' USING ERRCODE = '22023';
    END IF;
    IF p_review_due IS NULL OR p_review_due <= current_date OR p_review_due > current_date + interval '12 months' THEN
        RAISE EXCEPTION 'review due must be within 12 months (AC-2)' USING ERRCODE = '22023';
    END IF;
    IF v_just IS NULL OR length(v_just) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'invalid justification' USING ERRCODE = '22023';
    END IF;

    -- Duplicate pending request for same target raises 23505 via level_change_pending_uq.
    INSERT INTO level_change_requests (target_user, requested_by, current_level, new_level, justification, screening_verified, screening_ref, access_agreement_signed, access_agreement_date, review_due, fips199_basis)
    VALUES (p_target, p_actor, v_target.access_level, p_new_level, v_just, true, btrim(p_screening_ref), true, p_agreement_date, p_review_due, p_fips199_basis)
    RETURNING id INTO v_id;

    v_audit := log_audit(p_actor, 'level.request', 'user', p_target,
        format('Requested level %s -> %s for %s', v_target.access_level, p_new_level, p_target),
        jsonb_build_object('requestId', v_id, 'fromLevel', v_target.access_level, 'toLevel', p_new_level, 'fips199', p_fips199_basis,
                           'controls', ARRAY['AC-2', 'AC-3(2)', 'AC-5', 'AC-6', 'PS-3', 'PS-6', 'AU-2', 'AU-3']));

    RETURN jsonb_build_object('requestId', v_id::text, 'status', 'pending', 'auditId', v_audit);
END;
$$;

REVOKE ALL ON FUNCTION request_level_change(text, text, integer, text, boolean, text, boolean, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_level_change(text, text, integer, text, boolean, text, boolean, date, date, text) TO sad_app;

COMMIT;
