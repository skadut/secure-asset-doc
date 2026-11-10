-- Manual apply (existing DB volume already initialized, init scripts do not rerun):
-- docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/init/012_unit_head.sql
-- Unit head flag. Idempotent. Additive only, no data change.
BEGIN;

-- 1. Unit head flag. Display label only: grants no access. The column is read by the backend /api/me and user list queries, so apply 012 before deploying the backend.
ALTER TABLE users ADD COLUMN IF NOT EXISTS unit_head boolean NOT NULL DEFAULT false;

-- 1b. A unit head must carry a unit; NULL unit would bypass the unique index below.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_head_has_unit_check;
ALTER TABLE users ADD CONSTRAINT users_head_has_unit_check CHECK (NOT unit_head OR unit IS NOT NULL);

-- 2. At most one unit head per unit. Partial unique index. Seed sets the values; no rows touched here.
CREATE UNIQUE INDEX IF NOT EXISTS users_one_head_per_unit ON users(unit) WHERE unit_head;

-- 3. Privileges: none added. sad_app already has table-wide UPDATE on users (006), so unit_head is covered by that grant.

COMMIT;
