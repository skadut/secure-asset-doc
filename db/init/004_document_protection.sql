-- Seed rows (db/seed/002_seed.sql, applied after init) get protection='none' from the default,
-- with no tag and no ciphertext, so they satisfy document_versions_protection_shape.
-- Idempotent: columns use IF NOT EXISTS, constraints are guarded by pg_constraint lookups.
BEGIN;

ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS content_ciphertext text;
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS integrity_tag text;
ALTER TABLE document_versions ADD COLUMN IF NOT EXISTS protection text NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'document_versions'::regclass AND conname = 'document_versions_protection_check') THEN
    ALTER TABLE document_versions ADD CONSTRAINT document_versions_protection_check
      CHECK (protection IN ('none', 'integrity', 'encrypted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'document_versions'::regclass AND conname = 'document_versions_protection_shape') THEN
    ALTER TABLE document_versions ADD CONSTRAINT document_versions_protection_shape
      CHECK (
        (protection = 'none' AND content_ciphertext IS NULL AND integrity_tag IS NULL) OR
        (protection = 'integrity' AND content_base64 IS NOT NULL AND content_ciphertext IS NULL AND integrity_tag IS NOT NULL) OR
        (protection = 'encrypted' AND content_base64 IS NULL AND content_ciphertext IS NOT NULL AND integrity_tag IS NOT NULL)
      );
  END IF;
END $$;

COMMIT;
