#!/usr/bin/env bash
# Creates the rls_proof database if missing, then applies the schema and seed.
# Requires ADMIN_DATABASE_URL (postgres superuser) in the environment.
# The database path in that URL is replaced, so it only needs to point at the right server.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_NAME="rls_proof"

ADMIN_URL="${ADMIN_DATABASE_URL:?ADMIN_DATABASE_URL must be set (see .env.example)}"

# Strip the trailing /<database> segment. The URL must include one.
SERVER_URL="${ADMIN_URL%/*}"
MAINT_URL="${SERVER_URL}/postgres"
DB_URL="${SERVER_URL}/${DB_NAME}"

if [ "$(psql "$MAINT_URL" -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'")" != "1" ]; then
  psql "$MAINT_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME}"
fi

psql "$DB_URL" -v ON_ERROR_STOP=1 -f "${SCRIPT_DIR}/001_schema.sql"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "${SCRIPT_DIR}/002_seed.sql"
