BEGIN;

CREATE TABLE assets (
    id text PRIMARY KEY,
    name text NOT NULL,
    type text NOT NULL CHECK (type IN ('PLC', 'RTU', 'HMI', 'SCADA server', 'Historian', 'Engineering workstation', 'Firewall', 'Switch', 'Data diode')),
    site text NOT NULL,
    sector text NOT NULL CHECK (sector IN ('Energy', 'Water', 'Telecom')),
    purdue_level text NOT NULL CHECK (purdue_level IN ('L0', 'L1', 'L2', 'L3', 'L3.5', 'L4')),
    zone text NOT NULL,
    vendor text NOT NULL,
    model text NOT NULL,
    firmware text NOT NULL,
    ip_address inet NOT NULL,
    criticality text NOT NULL CHECK (criticality IN ('high', 'medium', 'low')),
    owner text NOT NULL,
    last_reviewed timestamptz NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'maintenance', 'retired'))
);

CREATE TABLE documents (
    id text PRIMARY KEY,
    title text NOT NULL,
    type text NOT NULL CHECK (type IN ('Policy', 'Procedure', 'Network diagram', 'Risk assessment', 'Incident response plan', 'Configuration baseline', 'Audit report', 'Personnel roster', 'Installation register', 'Equipment register')),
    tlp text NOT NULL CHECK (tlp IN ('CLEAR', 'GREEN', 'AMBER', 'AMBER+STRICT', 'RED')),
    status text NOT NULL CHECK (status IN ('draft', 'in review', 'approved', 'expired')),
    owner text NOT NULL,
    approver text NOT NULL,
    next_review timestamptz NOT NULL
);

CREATE TABLE document_versions (
    document_id text NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
    version text NOT NULL,
    date timestamptz NOT NULL,
    author text NOT NULL,
    summary text NOT NULL,
    approved_by text,
    file_name text,
    mime_type text,
    size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes <= 26214400),
    sha256 text,
    content_base64 text CHECK (content_base64 IS NULL OR length(content_base64) <= 34952536), -- 25 MiB raw as base64
    PRIMARY KEY (document_id, version)
);
-- ponytail: base64 text is ~33% larger than bytea; move files to S3-compatible object storage (keep sha256 + key here) when files grow

CREATE TABLE csf_subcategories (
    id text PRIMARY KEY,
    fn text NOT NULL CHECK (fn IN ('GV', 'ID', 'PR', 'DE', 'RS', 'RC')),
    category text NOT NULL,
    category_name text NOT NULL,
    outcome text NOT NULL
);

CREATE TABLE evidence_links (
    id text PRIMARY KEY,
    subcategory_id text NOT NULL REFERENCES csf_subcategories(id) ON DELETE RESTRICT,
    document_id text REFERENCES documents(id) ON DELETE RESTRICT,
    asset_id text REFERENCES assets(id) ON DELETE RESTRICT,
    note text NOT NULL,
    CHECK (num_nonnulls(document_id, asset_id) = 1)
);

CREATE TABLE asset_document_links (
    asset_id text NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    document_id text NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
    PRIMARY KEY (asset_id, document_id)
);

CREATE TABLE audit_events (
    id text PRIMARY KEY,
    at timestamptz NOT NULL,
    actor text NOT NULL,
    action text NOT NULL CHECK (action IN ('create', 'update', 'approve', 'link', 'unlink', 'export', 'delete')),
    object_type text NOT NULL CHECK (object_type IN ('asset', 'document', 'evidence')),
    object_id text NOT NULL,
    summary text NOT NULL,
    changes jsonb
);

CREATE FUNCTION reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE TRIGGER audit_events_no_row_mutation
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

CREATE TRIGGER audit_events_no_truncate
BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC;
COMMENT ON TABLE audit_events IS 'Append-only for ordinary roles, but not tamper-proof against the table owner or a superuser.';

COMMIT;
