#!/usr/bin/env bash
# Copy schema + data from one Supabase Postgres project to another.
# Requires pg_dump and psql on PATH. Secrets via env — never commit URLs with passwords.
set -euo pipefail

SOURCE_DATABASE_URL="${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL (direct session :5432)}"
TARGET_DATABASE_URL="${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL (direct session :5432)}"

WORKDIR="${TMPDIR:-/tmp}/lotaya-supabase-migrate-$$"
mkdir -p "$WORKDIR"
trap 'rm -rf "$WORKDIR"' EXIT

echo "Dumping source schema + data..."
pg_dump "$SOURCE_DATABASE_URL" \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  --schema=public \
  -f "$WORKDIR/dump.sql"

echo "Restoring to target..."
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$WORKDIR/dump.sql"

echo "Applying Prisma migrations on target (idempotent)..."
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
DATABASE_URL="$TARGET_DATABASE_URL" DATABASE_PROVIDER=postgresql \
  npx prisma migrate deploy --schema prisma/schema.postgresql.prisma

echo "Migration complete."
