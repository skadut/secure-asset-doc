BEGIN;

-- Shared demo TOTP secret, sealed (skadut-t1:...). Filled by db/scripts/seed-totp.mjs.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;

-- No GRANT: 006_rbac.sql grants SELECT, INSERT, UPDATE, DELETE on users to sad_app table-wide, so the new column is covered.

COMMIT;
