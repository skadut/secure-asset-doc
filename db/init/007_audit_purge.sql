-- PATI-only manual purge of audit_events older than a cutoff.
-- Leaves a permanent tombstone row (action 'purge') written via log_audit.
-- Idempotent: DROP CONSTRAINT IF EXISTS + re-ADD, CREATE OR REPLACE, REVOKE/GRANT.
-- Apply manually on live DB as admin (POSTGRES_USER). sad_app gets NO direct DELETE on audit_events.
BEGIN;

-- Extend audit vocabulary. Existing values kept verbatim (001 + 006).
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check
    CHECK (action IN ('create', 'update', 'approve', 'link', 'unlink', 'export', 'delete', 'access.denied', 'purge', 'grant', 'revoke'));

ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_object_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_object_type_check
    CHECK (object_type IN ('asset', 'document', 'evidence', 'upload', 'user', 'audit'));

-- Row triggers (BEFORE UPDATE OR DELETE, FOR EACH ROW) and statement trigger
-- (BEFORE TRUNCATE, FOR EACH STATEMENT) keep their definitions from 001.
-- Only the function body changes. TRUNCATE is statement-level, so OLD is NULL there.
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION 'audit_events is append-only';
    END IF;
    -- Only the purge function sets audit.purge_ok (transaction-local). Tombstones are never deleted.
    IF TG_OP = 'DELETE'
       AND current_setting('audit.purge_ok', true) = 'on'
       AND OLD.action <> 'purge' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE OR REPLACE FUNCTION purge_audit_events(p_actor text, p_before timestamptz) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    n int;
    v_date text;
    tombstone text;
BEGIN
    IF p_before IS NULL THEN
        RAISE EXCEPTION 'cutoff required';
    END IF;
    IF p_before > now() THEN
        RAISE EXCEPTION 'cutoff must not be in the future';
    END IF;

    v_date := to_char(p_before AT TIME ZONE 'UTC', 'YYYY-MM-DD');

    PERFORM set_config('audit.purge_ok', 'on', true);
    DELETE FROM audit_events WHERE at < p_before AND action <> 'purge';
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('audit.purge_ok', 'off', true);

    tombstone := log_audit(
        p_actor, 'purge', 'audit', v_date,
        format('Purged %s audit entries older than %s', n, v_date),
        jsonb_build_object('before', p_before, 'deleted', n)
    );

    RETURN jsonb_build_object('deleted', n, 'tombstoneId', tombstone);
END;
$$;

REVOKE ALL ON FUNCTION purge_audit_events(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_audit_events(text, timestamptz) TO sad_app;

COMMIT;
