BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS nist_controls (
    id text PRIMARY KEY,
    family text NOT NULL,
    name text NOT NULL,
    implementation text NOT NULL,
    location text NOT NULL
);

CREATE TABLE IF NOT EXISTS traffic_samples (
    bucket_start timestamptz NOT NULL,
    source text NOT NULL,
    target text NOT NULL,
    window_seconds int NOT NULL,
    request_count int NOT NULL,
    error_count int NOT NULL,
    total_ms bigint NOT NULL,
    PRIMARY KEY (bucket_start, source, target)
);

CREATE TABLE IF NOT EXISTS viewer_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_at_desc_idx ON audit_events (at DESC);
CREATE INDEX IF NOT EXISTS audit_events_action_at_desc_idx ON audit_events (action, at DESC);
CREATE INDEX IF NOT EXISTS document_versions_date_desc_idx ON document_versions (date DESC);
CREATE INDEX IF NOT EXISTS access_requests_status_created_at_desc_idx ON access_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_last_seen_desc_idx ON sessions (last_seen DESC);
CREATE INDEX IF NOT EXISTS traffic_samples_source_target_bucket_start_desc_idx ON traffic_samples (source, target, bucket_start DESC);
CREATE INDEX IF NOT EXISTS traffic_samples_bucket_start_idx ON traffic_samples (bucket_start);
CREATE INDEX IF NOT EXISTS nist_controls_family_id_idx ON nist_controls (family, id);
CREATE INDEX IF NOT EXISTS viewer_sessions_user_document_expires_at_desc_idx ON viewer_sessions (user_id, document_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS viewer_sessions_expires_at_idx ON viewer_sessions (expires_at);

GRANT SELECT ON nist_controls TO sad_app;
GRANT SELECT, INSERT, DELETE ON traffic_samples, viewer_sessions TO sad_app;
GRANT UPDATE ON traffic_samples TO sad_app;

COMMIT;
