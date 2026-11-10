-- Manual apply (existing DB volume already initialized, init scripts do not rerun):
-- docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/011_level_change.sql
-- Level change: raise = officer request + commander approve (dual control); lower = single person, immediate.
-- Idempotent. No data deletion except sessions rows of the target user on apply/lower.
BEGIN;

-- 1. Audit vocabulary: 010 list plus level.* actions. object_type 'user' already in audit_events_object_type_check (006).
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check
    CHECK (action IN ('create', 'update', 'approve', 'link', 'unlink', 'export', 'delete', 'access.denied', 'purge', 'grant', 'revoke', 'derive', 'access.request', 'access.approve', 'access.deny', 'access.grant', 'access.revoke', 'level.request', 'level.approve', 'level.deny', 'level.apply', 'level.lowered'));

-- 2. Raise requests only. Lowering writes audit only (no row).
CREATE TABLE IF NOT EXISTS level_change_requests (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    target_user text NOT NULL REFERENCES users(username) ON UPDATE CASCADE,
    requested_by text NOT NULL REFERENCES users(username) ON UPDATE CASCADE,
    current_level int NOT NULL CHECK (current_level BETWEEN 1 AND 5),
    new_level int NOT NULL CHECK (new_level BETWEEN 1 AND 5),
    justification text NOT NULL CHECK (length(btrim(justification)) BETWEEN 1 AND 500),
    screening_verified boolean NOT NULL,
    screening_ref text NOT NULL CHECK (length(btrim(screening_ref)) BETWEEN 1 AND 120),
    access_agreement_signed boolean NOT NULL,
    access_agreement_date date NOT NULL,
    review_due date NOT NULL,
    fips199_basis text NOT NULL CHECK (fips199_basis IN ('LOW', 'MODERATE', 'HIGH')),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
    decided_by text NULL REFERENCES users(username) ON UPDATE CASCADE,
    decided_at timestamptz NULL,
    decision_reason text NULL CHECK (decision_reason IS NULL OR length(decision_reason) <= 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (new_level > current_level),
    CHECK (requested_by <> target_user)
);

CREATE UNIQUE INDEX IF NOT EXISTS level_change_pending_uq ON level_change_requests(target_user) WHERE status = 'pending';

-- 3. Lock-down. Writes only through the functions below.
REVOKE ALL ON level_change_requests FROM PUBLIC;
GRANT SELECT ON level_change_requests TO sad_app;

-- 4. Requester side: officer (not level 5) proposes a raise. Nobody changes own account.
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
    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.username = p_actor AND u.active AND u.security_officer AND u.access_level <> 5) THEN
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

-- 5. Approver side. Commander approves raises (apply). Officer or commander may deny.
CREATE OR REPLACE FUNCTION decide_level_change(p_actor text, p_request_id bigint, p_decision text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_req level_change_requests%ROWTYPE;
    v_role text;
    v_target users%ROWTYPE;
    v_reason text := NULLIF(btrim(p_reason), '');
    v_count int := 0;
    v_audit text;
BEGIN
    SELECT * INTO v_req FROM level_change_requests WHERE id = p_request_id FOR UPDATE;
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
    IF p_actor IN (v_req.requested_by, v_req.target_user) THEN
        RAISE EXCEPTION 'requester and target cannot decide' USING ERRCODE = '42501';
    END IF;
    IF p_decision = 'approve' AND v_role <> 'commander' THEN
        RAISE EXCEPTION 'only commander approves level change' USING ERRCODE = '42501';
    END IF;

    IF p_decision = 'approve' THEN
        SELECT * INTO v_target FROM users u WHERE u.username = v_req.target_user AND u.active;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
        END IF;
        IF v_target.access_level <> v_req.current_level THEN
            RAISE EXCEPTION 'level changed since request' USING ERRCODE = '55000';
        END IF;
        IF v_req.new_level = 5 AND v_target.security_officer THEN
            RAISE EXCEPTION 'security officer cannot be level 5' USING ERRCODE = '22023';
        END IF;
        IF NOT COALESCE((v_req.new_level IN (1, 2) AND v_req.fips199_basis = 'LOW')
                     OR (v_req.new_level = 3 AND v_req.fips199_basis = 'MODERATE')
                     OR (v_req.new_level IN (4, 5) AND v_req.fips199_basis = 'HIGH'), false) THEN
            RAISE EXCEPTION 'FIPS 199 basis does not match level' USING ERRCODE = '22023';
        END IF;
        IF v_req.review_due < current_date THEN
            RAISE EXCEPTION 'review due date has passed' USING ERRCODE = '22023';
        END IF;

        -- Apply: new level, then drop active sessions of target so new level applies at once.
        UPDATE users SET access_level = v_req.new_level WHERE id = v_target.id;
        DELETE FROM sessions WHERE user_id = v_target.id;
        GET DIAGNOSTICS v_count = ROW_COUNT;

        UPDATE level_change_requests
           SET status = 'approved', decided_by = p_actor, decided_at = now(), decision_reason = v_reason
         WHERE id = p_request_id;

        PERFORM log_audit(p_actor, 'level.approve', 'user', v_req.target_user,
            format('Approved level %s -> %s for %s', v_req.current_level, v_req.new_level, v_req.target_user),
            jsonb_build_object('requestId', p_request_id, 'fromLevel', v_req.current_level, 'toLevel', v_req.new_level,
                               'controls', ARRAY['AC-2', 'AC-3(2)', 'AC-5', 'AC-6', 'PS-3', 'PS-6', 'AU-2', 'AU-3']));

        v_audit := log_audit(p_actor, 'level.apply', 'user', v_req.target_user,
            format('Applied level %s -> %s for %s', v_req.current_level, v_req.new_level, v_req.target_user),
            jsonb_build_object('requestId', p_request_id, 'fromLevel', v_req.current_level, 'toLevel', v_req.new_level,
                               'sessionsRevoked', v_count,
                               'controls', ARRAY['AC-2', 'AC-3(2)', 'AC-5', 'AC-6', 'PS-3', 'PS-6', 'AU-2', 'AU-3']));

        RETURN jsonb_build_object('requestId', p_request_id::text, 'status', 'approved', 'applied', true, 'auditId', v_audit);
    END IF;

    -- Deny path.
    UPDATE level_change_requests
       SET status = 'denied', decided_by = p_actor, decided_at = now(), decision_reason = v_reason
     WHERE id = p_request_id;

    v_audit := log_audit(p_actor, 'level.deny', 'user', v_req.target_user,
        format('Denied level %s -> %s for %s', v_req.current_level, v_req.new_level, v_req.target_user),
        jsonb_build_object('requestId', p_request_id, 'fromLevel', v_req.current_level, 'toLevel', v_req.new_level,
                           'controls', ARRAY['AC-2', 'AC-3(2)', 'AC-5', 'AC-6', 'PS-3', 'PS-6', 'AU-2', 'AU-3']));

    RETURN jsonb_build_object('requestId', p_request_id::text, 'status', 'denied', 'applied', false, 'auditId', v_audit);
END;
$$;

-- 6. Lowering: single person, immediate, no request row. Officer or commander, not to self. New level must be lower.
CREATE OR REPLACE FUNCTION lower_user_level(p_actor text, p_target text, p_new_level int, p_justification text) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target users%ROWTYPE;
    v_just text := btrim(p_justification);
    v_count int := 0;
    v_audit text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users u WHERE u.username = p_actor AND u.active AND (u.access_level = 5 OR u.security_officer)) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF p_actor = p_target THEN
        RAISE EXCEPTION 'self-change not allowed' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_target FROM users u WHERE u.username = p_target AND u.active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
    END IF;
    IF p_new_level IS NULL OR p_new_level NOT BETWEEN 1 AND v_target.access_level - 1 THEN
        RAISE EXCEPTION 'new level must be between 1 and current level minus 1' USING ERRCODE = '22023';
    END IF;
    IF v_just IS NULL OR length(v_just) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'invalid justification' USING ERRCODE = '22023';
    END IF;

    UPDATE users SET access_level = p_new_level WHERE id = v_target.id;
    DELETE FROM sessions WHERE user_id = v_target.id;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    v_audit := log_audit(p_actor, 'level.lowered', 'user', p_target,
        format('Lowered level %s -> %s for %s', v_target.access_level, p_new_level, p_target),
        jsonb_build_object('fromLevel', v_target.access_level, 'toLevel', p_new_level, 'sessionsRevoked', v_count,
                           'justification', v_just,
                           'controls', ARRAY['AC-2', 'AC-3(2)', 'AC-5', 'AC-6', 'PS-3', 'PS-6', 'AU-2', 'AU-3']));

    RETURN jsonb_build_object('username', p_target, 'fromLevel', v_target.access_level, 'toLevel', p_new_level, 'applied', true, 'auditId', v_audit);
END;
$$;

-- 7. Privileges: app role executes only.
REVOKE ALL ON FUNCTION request_level_change(text, text, integer, text, boolean, text, boolean, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_level_change(text, text, integer, text, boolean, text, boolean, date, date, text) TO sad_app;
REVOKE ALL ON FUNCTION decide_level_change(text, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decide_level_change(text, bigint, text, text) TO sad_app;
REVOKE ALL ON FUNCTION lower_user_level(text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lower_user_level(text, text, integer, text) TO sad_app;

COMMIT;
