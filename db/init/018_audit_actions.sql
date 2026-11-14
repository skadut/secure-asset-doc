-- Qualified audit actions for document upload and asset write routes. Idempotent.
BEGIN;
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN ('create', 'update', 'approve', 'link', 'unlink', 'export', 'delete', 'access.denied', 'purge', 'grant', 'revoke', 'derive', 'access.request', 'access.approve', 'access.deny', 'access.grant', 'access.revoke', 'level.request', 'level.approve', 'level.deny', 'level.apply', 'level.lowered', 'login.password.fail', 'login.code.fail', 'login.locked', 'login.success', 'logout', 'doc.upload', 'asset.create', 'asset.update', 'asset.delete'));
COMMIT;
