ALTER TABLE "OsBatchObligation" ADD COLUMN "openingAdjustment" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "adjustmentReason" TEXT,
ADD COLUMN "adjustmentApprovedBy" TEXT,
ADD COLUMN "adjustmentApprovedAt" TIMESTAMP(3);
