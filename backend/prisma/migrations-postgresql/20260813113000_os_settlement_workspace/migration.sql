CREATE TABLE "OsSettlement" (
  "id" TEXT NOT NULL PRIMARY KEY, "shopId" TEXT NOT NULL, "hubId" TEXT NOT NULL,
  "businessDate" TIMESTAMP(3) NOT NULL, "grossCollectedCod" INTEGER NOT NULL,
  "advanceDeduction" INTEGER NOT NULL, "returnDeduction" INTEGER NOT NULL,
  "deliveryFeeDeduction" INTEGER NOT NULL, "adjustmentAmount" INTEGER NOT NULL DEFAULT 0,
  "adjustmentReason" TEXT, "netAmount" INTEGER NOT NULL, "wallet" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'POSTED', "idempotencyKey" TEXT NOT NULL,
  "postedBy" TEXT NOT NULL, "reversedAt" TIMESTAMP(3), "reversedBy" TEXT,
  "reversalReason" TEXT, "journalEntryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OsSettlement_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "OnlineShop"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OsSettlement_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "OsSettlementBatch" (
  "id" TEXT NOT NULL PRIMARY KEY, "settlementId" TEXT NOT NULL, "batchId" TEXT NOT NULL,
  "collectedCod" INTEGER NOT NULL, "advanceAmount" INTEGER NOT NULL,
  "returnedAdvance" INTEGER NOT NULL, "deliveryFees" INTEGER NOT NULL,
  CONSTRAINT "OsSettlementBatch_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "OsSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OsSettlementBatch_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OsSettlement_idempotencyKey_key" ON "OsSettlement"("idempotencyKey");
CREATE UNIQUE INDEX "OsSettlement_journalEntryId_key" ON "OsSettlement"("journalEntryId");
CREATE INDEX "OsSettlement_hubId_businessDate_idx" ON "OsSettlement"("hubId", "businessDate");
CREATE INDEX "OsSettlement_shopId_status_businessDate_idx" ON "OsSettlement"("shopId", "status", "businessDate");
CREATE UNIQUE INDEX "OsSettlementBatch_settlementId_batchId_key" ON "OsSettlementBatch"("settlementId", "batchId");
CREATE INDEX "OsSettlementBatch_batchId_idx" ON "OsSettlementBatch"("batchId");
