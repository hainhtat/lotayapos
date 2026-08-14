#!/usr/bin/env bash
# Run on the VPS as root after setting NEW_DB_PASSWORD. Never commit passwords.
set -euo pipefail

ROOT=/opt/lotaya/repo
ENV_FILE=/opt/lotaya/shared/lotaya.env

: "${NEW_DB_PASSWORD:?Set NEW_DB_PASSWORD to the new Supabase database password}"
: "${NEW_PROJECT_REF:=swglrjikdlntqzpwatyx}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root on the VPS." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"

set -a
# shellcheck disable=SC1091
source "$ENV_FILE"
set +a

SOURCE_URL="${DIRECT_DATABASE_URL:-$DATABASE_URL}"
SOURCE_URL="${SOURCE_URL//:6543/:5432}"
SOURCE_URL="${SOURCE_URL//pgbouncer=true/}"

NEW_DIRECT="postgresql://postgres.${NEW_PROJECT_REF}:${NEW_DB_PASSWORD}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
NEW_RUNTIME="postgresql://postgres.${NEW_PROJECT_REF}:${NEW_DB_PASSWORD}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"

echo "Migrating data to Singapore Supabase..."
SOURCE_DATABASE_URL="$SOURCE_URL" TARGET_DATABASE_URL="$NEW_DIRECT" bash "$ROOT/scripts/supabase-region-migrate.sh"

grep -v '^DATABASE_URL=' "$ENV_FILE" | grep -v '^DIRECT_DATABASE_URL=' | grep -v '^DATABASE_PROVIDER=' > "${ENV_FILE}.tmp" || true
{
  cat "${ENV_FILE}.tmp"
  echo 'DATABASE_PROVIDER=postgresql'
  echo "DATABASE_URL=${NEW_RUNTIME}"
  echo "DIRECT_DATABASE_URL=${NEW_DIRECT}"
} > "$ENV_FILE"
rm -f "${ENV_FILE}.tmp"
chmod 640 "$ENV_FILE"

echo "Env updated. Running deploy..."
bash "$ROOT/deploy.sh"
echo "Cutover complete."
