#!/bin/sh
# Least-privilege login role for the backend. Runs only on a fresh pgdata volume.
set -e
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 -v app_pw="$APP_DB_PASSWORD" -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'EOSQL'
CREATE ROLE sad_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO sad_app', current_database()); END $$;
GRANT USAGE ON SCHEMA public TO sad_app;
GRANT SELECT ON assets, documents, document_versions, csf_subcategories, evidence_links, asset_document_links, audit_events TO sad_app;
-- uploaded_files.id defaults to gen_random_uuid(); no sequence grant needed.
GRANT SELECT, INSERT ON uploaded_files TO sad_app;
EOSQL
