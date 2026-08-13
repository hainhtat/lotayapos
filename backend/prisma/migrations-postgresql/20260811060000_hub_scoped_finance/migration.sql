ALTER TABLE "JournalEntry" ADD COLUMN "hubId" TEXT;
ALTER TABLE "CashbookDay" ADD COLUMN "hubId" TEXT;

DROP INDEX "CashbookDay_businessDate_key";
CREATE UNIQUE INDEX "CashbookDay_hubId_businessDate_key" ON "CashbookDay"("hubId", "businessDate");
CREATE INDEX "JournalEntry_hubId_businessDate_idx" ON "JournalEntry"("hubId", "businessDate");

ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashbookDay" ADD CONSTRAINT "CashbookDay_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;
