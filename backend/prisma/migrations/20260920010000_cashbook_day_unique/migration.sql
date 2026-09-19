-- Keep SQLite in sync for local parity (unique already expected by schema).
CREATE UNIQUE INDEX IF NOT EXISTS "CashbookDay_hubId_businessDate_key"
  ON "CashbookDay"("hubId", "businessDate");
