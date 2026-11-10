-- Derive a lower-TLP document without copying parent content.
-- Apply manually on live DB as admin. Idempotent.
-- Additive only: adds lineage metadata, audit vocabulary, and a controlled function.
BEGIN;

ALTER TABLE documents ADD COLUMN IF NOT EXISTS derived_from text REFERENCES documents(id) ON DELETE RESTRICT;

ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check
    CHECK (action IN ('create', 'update', 'approve', 'link', 'unlink', 'export', 'delete', 'access.denied', 'purge', 'grant', 'revoke', 'derive'));

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
    IF p_tlp IS NULL OR p_tlp NOT IN ('CLEAR', 'GREEN', 'AMBER', 'AMBER+STRICT', 'RED') THEN
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
        END) >=
       (CASE v_parent_tlp
            WHEN 'CLEAR' THEN 0
            WHEN 'GREEN' THEN 1
            WHEN 'AMBER' THEN 2
            WHEN 'AMBER+STRICT' THEN 3
            WHEN 'RED' THEN 4
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
