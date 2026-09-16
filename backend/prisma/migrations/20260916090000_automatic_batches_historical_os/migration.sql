ALTER TABLE "Batch" ADD COLUMN "automaticAccounting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Batch" ADD COLUMN "creationKey" TEXT;
ALTER TABLE "Batch" ADD COLUMN "creationHash" TEXT;
ALTER TABLE "Batch" ADD COLUMN "createdBy" TEXT;
CREATE UNIQUE INDEX "Batch_creationKey_key" ON "Batch"("creationKey");
ALTER TABLE "Parcel" ADD COLUMN "plannedDeliveryDate" DATETIME;
CREATE INDEX "Parcel_status_createdAt_idx" ON "Parcel"("status", "createdAt");
CREATE TABLE "OsHistoricalSettlement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "batchId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "businessDate" DATETIME NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "adjustmentId" TEXT NOT NULL,
  "journalEntryId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OsHistoricalSettlement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OsHistoricalSettlement_batchId_key" ON "OsHistoricalSettlement"("batchId");
CREATE UNIQUE INDEX "OsHistoricalSettlement_journalEntryId_key" ON "OsHistoricalSettlement"("journalEntryId");
