-- Production drift: CashbookDay upserts require a unique target for ON CONFLICT.
-- Some environments were marked migrated without this index, causing 42P10 on delivery posts.
DELETE FROM "CashbookDay" AS duplicate
USING "CashbookDay" AS keeper
WHERE duplicate."hubId" = keeper."hubId"
  AND duplicate."businessDate" = keeper."businessDate"
  AND duplicate."id" > keeper."id";

CREATE UNIQUE INDEX IF NOT EXISTS "CashbookDay_hubId_businessDate_key"
  ON "CashbookDay"("hubId", "businessDate");
