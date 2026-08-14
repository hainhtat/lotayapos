#!/usr/bin/env bash
# Copy schema + data from one Supabase Postgres project to another.
# Requires pg_dump and psql on PATH. Secrets via env — never commit URLs with passwords.
# Set MIGRATE_MODE=data-only when the target already has Prisma migrations applied.
set -euo pipefail

SOURCE_DATABASE_URL="${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL (direct session :5432)}"
TARGET_DATABASE_URL="${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL (direct session :5432)}"
MIGRATE_MODE="${MIGRATE_MODE:-full}"

WORKDIR="${TMPDIR:-/tmp}/lotaya-supabase-migrate-$$"
mkdir -p "$WORKDIR"
trap 'rm -rf "$WORKDIR"' EXIT

echo "Dumping source ($MIGRATE_MODE)..."
PG_DUMP=(pg_dump)
if [[ -x /opt/homebrew/opt/libpq@17/bin/pg_dump ]]; then
  PG_DUMP=(/opt/homebrew/opt/libpq@17/bin/pg_dump)
elif command -v docker >/dev/null 2>&1; then
  local_major="$(pg_dump --version 2>/dev/null | sed -n 's/.* \([0-9]*\).*/\1/p')"
  if [[ -z "${local_major}" || "${local_major}" -lt 17 ]]; then
    PG_DUMP=(docker run --rm -i postgres:17 pg_dump)
  fi
fi

DUMP_ARGS=(--no-owner --no-acl --schema=public -f "$WORKDIR/dump.sql")
if [[ "$MIGRATE_MODE" == "data-only" ]]; then
  DUMP_ARGS=(--data-only "${DUMP_ARGS[@]}")
else
  DUMP_ARGS=(--clean --if-exists "${DUMP_ARGS[@]}")
fi

"${PG_DUMP[@]}" "$SOURCE_DATABASE_URL" "${DUMP_ARGS[@]}"

echo "Restoring to target..."
PSQL=(psql)
if [[ -x /opt/homebrew/opt/libpq@17/bin/psql ]]; then
  PSQL=(/opt/homebrew/opt/libpq@17/bin/psql)
fi
if [[ "$MIGRATE_MODE" == "data-only" ]]; then
  echo "Truncating target public tables..."
  "${PSQL[@]}" "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE row RECORD;
BEGIN
  FOR row IN (
    SELECT quote_ident(tablename) AS name
    FROM pg_tables
    WHERE schemaname = 'public'
  ) LOOP
    EXECUTE 'TRUNCATE TABLE ' || row.name || ' CASCADE';
  END LOOP;
END $$;
SQL
  {
    echo "SET session_replication_role = replica;"
    cat "$WORKDIR/dump.sql"
  } | "${PSQL[@]}" "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1
else
  "${PSQL[@]}" "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$WORKDIR/dump.sql"
fi

echo "Applying Prisma migrations on target (idempotent)..."
if [[ "$MIGRATE_MODE" != "data-only" ]]; then
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
DATABASE_URL="$TARGET_DATABASE_URL" DATABASE_PROVIDER=postgresql \
  npx prisma migrate deploy --schema prisma/schema.postgresql.prisma
fi

echo "Migration complete."
