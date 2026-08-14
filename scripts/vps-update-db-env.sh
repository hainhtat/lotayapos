#!/usr/bin/env bash
# Update VPS env to Singapore Supabase and redeploy. Data must already be migrated.
# Usage on VPS: NEW_DB_PASSWORD='...' bash scripts/vps-update-db-env.sh
set -euo pipefail

ENV_FILE=/opt/lotaya/shared/lotaya.env
ROOT=/opt/lotaya/repo

: "${NEW_DB_PASSWORD:?Set NEW_DB_PASSWORD}"
: "${NEW_PROJECT_REF:=swglrjikdlntqzpwatyx}"

NEW_DIRECT="postgresql://postgres.${NEW_PROJECT_REF}:${NEW_DB_PASSWORD}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres"
NEW_RUNTIME="postgresql://postgres.${NEW_PROJECT_REF}:${NEW_DB_PASSWORD}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"

cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
grep -v '^DATABASE_URL=' "$ENV_FILE" | grep -v '^DIRECT_DATABASE_URL=' | grep -v '^DATABASE_PROVIDER=' > "${ENV_FILE}.tmp" || true
{
  cat "${ENV_FILE}.tmp"
  echo 'DATABASE_PROVIDER=postgresql'
  echo "DATABASE_URL=${NEW_RUNTIME}"
  echo "DIRECT_DATABASE_URL=${NEW_DIRECT}"
} > "$ENV_FILE"
rm -f "${ENV_FILE}.tmp"
chmod 640 "$ENV_FILE"

cd "$ROOT" && git pull --ff-only origin main && bash "$ROOT/deploy.sh"
echo "VPS now points at Singapore Supabase."
