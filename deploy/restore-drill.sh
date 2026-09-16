#!/usr/bin/env bash
# Restore a PostgreSQL custom-format backup into a NEW, isolated database.
# Supply libpq PGHOST/PGPORT/PGUSER/PGPASSWORD (or .pgpass), never a live target DB.
# Intentionally leaves the restored database for inspection and manual removal.
set -euo pipefail
archive="${1:?Usage: restore-drill.sh /path/to/backup.dump}"
[[ -s "${archive}" ]] || { echo "Backup archive is missing or empty" >&2; exit 1; }
for tool in pg_restore createdb psql; do command -v "${tool}" >/dev/null; done
pg_restore --list "${archive}" >/dev/null
drill_db="lotaya_restore_drill_$(date -u +%Y%m%d%H%M%S)_${RANDOM}"
createdb "${drill_db}"
echo "Created isolated restore database: ${drill_db}"
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --dbname "${drill_db}" "${archive}"
psql -X --set ON_ERROR_STOP=1 --dbname "${drill_db}" <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'Backup contains an incomplete migration';
  END IF;
  IF EXISTS (SELECT "entryId" FROM "JournalLine" GROUP BY "entryId" HAVING SUM(debit::bigint) <> SUM(credit::bigint)) THEN
    RAISE EXCEPTION 'Restored ledger contains unbalanced journals';
  END IF;
END $$;
SELECT COUNT(*) AS journals FROM "JournalEntry";
SELECT account, SUM(debit::bigint) - SUM(credit::bigint) AS balance
FROM "JournalLine" WHERE account IN ('WALLET_CASH','WALLET_KBZ_PAY','WALLET_WAVE_PAY') GROUP BY account ORDER BY account;
SQL
echo "Restore and ledger checks passed in ${drill_db}. Compare these wallet totals to the backup-time snapshot before accepting the backup."
echo "Database retained for inspection; no production database was overwritten."
