ALTER TABLE "OsSettlement" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OsSettlement" ADD COLUMN "supersedesId" TEXT;
CREATE UNIQUE INDEX "OsSettlement_supersedesId_key" ON "OsSettlement"("supersedesId");

CREATE TABLE "OsSettlementDraft" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "hubId" TEXT NOT NULL,
  "batchIdsJson" TEXT NOT NULL,
  "businessDate" TIMESTAMP(3) NOT NULL,
  "wallet" TEXT NOT NULL,
  "advanceDeduction" INTEGER NOT NULL,
  "returnDeduction" INTEGER NOT NULL,
  "deliveryFeeDeduction" INTEGER NOT NULL,
  "adjustmentAmount" INTEGER NOT NULL DEFAULT 0,
  "adjustmentReason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "OsSettlementDraft_hubId_updatedAt_idx" ON "OsSettlementDraft"("hubId", "updatedAt");
CREATE INDEX "OsSettlementDraft_shopId_updatedAt_idx" ON "OsSettlementDraft"("shopId", "updatedAt");

CREATE TABLE "OsSettlementEditAudit" (
  "id" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "beforeJson" TEXT NOT NULL,
  "afterJson" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OsSettlementEditAudit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OsSettlementEditAudit_idempotencyKey_key" ON "OsSettlementEditAudit"("idempotencyKey");
CREATE INDEX "OsSettlementEditAudit_targetType_targetId_createdAt_idx" ON "OsSettlementEditAudit"("targetType", "targetId", "createdAt");
