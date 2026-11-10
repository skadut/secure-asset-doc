-- Manual apply (existing DB volume already initialized, init scripts do not rerun):
-- docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/015_field_protection.sql
-- Field protection: columns that now hold tokens (masked:t1:...) or sealed text (skadut-t1:...). Schema only, no row data changes
-- except the inet -> text cast of assets.ip_address. Idempotent. Apply before the backend that seals on write; then run
-- db/scripts/protect-fields.mjs to protect existing rows. Plaintext length limits move to the backend (checked before sealing).
BEGIN;

-- 1. assets.ip_address: inet cannot hold a token. host() keeps the address without the /32 mask.
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'assets' AND column_name = 'ip_address') = 'inet' THEN
    ALTER TABLE assets ALTER COLUMN ip_address TYPE text USING host(ip_address);
  END IF;
END $$;

-- 2. Length CHECKs sized for ciphertext, not plaintext. 4096 covers a sealed 500-char value and a tokenized 200-char name.
ALTER TABLE access_requests DROP CONSTRAINT IF EXISTS access_requests_reason_check;
ALTER TABLE access_requests ADD CONSTRAINT access_requests_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 4096);
ALTER TABLE access_approvals DROP CONSTRAINT IF EXISTS access_approvals_reason_check;
ALTER TABLE access_approvals ADD CONSTRAINT access_approvals_reason_check CHECK (reason IS NULL OR length(reason) <= 4096);
ALTER TABLE level_change_requests DROP CONSTRAINT IF EXISTS level_change_requests_justification_check;
ALTER TABLE level_change_requests ADD CONSTRAINT level_change_requests_justification_check CHECK (length(btrim(justification)) BETWEEN 1 AND 4096);
ALTER TABLE level_change_requests DROP CONSTRAINT IF EXISTS level_change_requests_screening_ref_check;
ALTER TABLE level_change_requests ADD CONSTRAINT level_change_requests_screening_ref_check CHECK (length(btrim(screening_ref)) BETWEEN 1 AND 4096);
ALTER TABLE level_change_requests DROP CONSTRAINT IF EXISTS level_change_requests_decision_reason_check;
ALTER TABLE level_change_requests ADD CONSTRAINT level_change_requests_decision_reason_check CHECK (decision_reason IS NULL OR length(decision_reason) <= 4096);
ALTER TABLE uploaded_files DROP CONSTRAINT IF EXISTS uploaded_files_name_check;
ALTER TABLE uploaded_files ADD CONSTRAINT uploaded_files_name_check CHECK (char_length(name) BETWEEN 1 AND 4096);

-- 3. document_versions.sha256: plaintext file hash, stored only, never read. integrity_tag (HMAC) replaces it.
ALTER TABLE document_versions DROP COLUMN IF EXISTS sha256;

-- 4. Functions: same bodies as 010/011/014, with ciphertext-sized limits; derive without sha256; lower_user_level audit without justification.
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
    IF v_reason IS NULL OR length(v_reason) NOT BETWEEN 1 AND 4096 THEN
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
    IF p_screening_verified IS NOT TRUE OR p_screening_ref IS NULL OR length(btrim(p_screening_ref)) NOT BETWEEN 1 AND 4096 THEN
        RAISE EXCEPTION 'screening required (PS-3)' USING ERRCODE = '22023';
    END IF;
    IF p_agreement_signed IS NOT TRUE OR p_agreement_date IS NULL OR p_agreement_date > current_date THEN
        RAISE EXCEPTION 'access agreement required (PS-6)' USING ERRCODE = '22023';
    END IF;
    IF p_review_due IS NULL OR p_review_due <= current_date OR p_review_due > current_date + interval '12 months' THEN
        RAISE EXCEPTION 'review due must be within 12 months (AC-2)' USING ERRCODE = '22023';
    END IF;
    IF v_just IS NULL OR length(v_just) NOT BETWEEN 1 AND 4096 THEN
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
                           'controls', ARRAY['AC-2', 'AC-3(2)', 'AC-5', 'AC-6', 'PS-3', 'PS-6', 'AU-2', 'AU-3']));

    RETURN jsonb_build_object('username', p_target, 'fromLevel', v_target.access_level, 'toLevel', p_new_level, 'applied', true, 'auditId', v_audit);
END;
$$;
REVOKE ALL ON FUNCTION lower_user_level(text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lower_user_level(text, text, integer, text) TO sad_app;
REVOKE ALL ON FUNCTION request_document_access(text, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_document_access(text, text, text, text, timestamptz) TO sad_app;

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
    IF p_summary IS NULL OR length(btrim(p_summary)) NOT BETWEEN 1 AND 32768 THEN
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

    INSERT INTO document_versions (document_id, version, date, author, summary, file_name, mime_type, size_bytes, content_base64, protection, content_ciphertext, integrity_tag)
    VALUES (v_id, '1.0', CURRENT_DATE, p_actor, btrim(p_summary), NULL, NULL, NULL, NULL, 'none', NULL, NULL);

    v_audit := log_audit(p_actor, 'derive', 'document', v_id,
        'Derived ' || v_id || ' from ' || p_parent_id,
        jsonb_build_object('parent', p_parent_id, 'tlp', p_tlp));

    RETURN jsonb_build_object('documentId', v_id, 'auditId', v_audit, 'derivedFrom', p_parent_id);
END;
$$;

REVOKE ALL ON FUNCTION derive_document(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION derive_document(text, text, text, text, text) TO sad_app;

COMMIT;
