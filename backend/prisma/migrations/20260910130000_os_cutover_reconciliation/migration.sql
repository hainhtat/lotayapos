ALTER TABLE "OsBatchObligation" ADD COLUMN "openingAdjustment" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OsBatchObligation" ADD COLUMN "adjustmentReason" TEXT;
ALTER TABLE "OsBatchObligation" ADD COLUMN "adjustmentApprovedBy" TEXT;
ALTER TABLE "OsBatchObligation" ADD COLUMN "adjustmentApprovedAt" DATETIME;
