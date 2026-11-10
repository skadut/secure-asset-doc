BEGIN;

CREATE TABLE IF NOT EXISTS uploaded_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
    mime text NOT NULL CHECK (mime IN ('application/pdf', 'image/png', 'image/jpeg', 'text/plain')),
    size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    ciphertext text NOT NULL,
    uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uploaded_files_uploaded_at_desc_idx ON uploaded_files (uploaded_at DESC);

-- Backend role (PGUSER): insert and select only, no UPDATE, DELETE, TRUNCATE.
GRANT SELECT, INSERT ON uploaded_files TO sad;

COMMENT ON TABLE uploaded_files IS 'Encrypted uploads (ciphertext only). Backend role may insert and select; no update, delete, or truncate.';

COMMIT;
