ALTER TABLE "OnlineShop" ADD COLUMN "includeDeliveryFeeInOsCredit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Parcel" ADD COLUMN "collectionMode" TEXT NOT NULL DEFAULT 'CASH_RECEIPT_EXCEPTION';
ALTER TABLE "Parcel" ADD COLUMN "paidToOsFeeIncluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OsReturnCredit" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PHYSICAL_RETURN';
ALTER TABLE "OsReturnCredit" ADD COLUMN "codAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OsReturnCredit" ADD COLUMN "feeAmount" INTEGER NOT NULL DEFAULT 0;
UPDATE "OsReturnCredit" SET "codAmount" = "amount" WHERE "codAmount" = 0;
CREATE TABLE "OsAdvanceCreditAllocation" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "creditId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OsAdvanceCreditAllocation_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "OsAdvanceCreditAllocation" ADD CONSTRAINT "OsAdvanceCreditAllocation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OsAdvanceCreditAllocation" ADD CONSTRAINT "OsAdvanceCreditAllocation_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "OsReturnCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "OsAdvanceCreditAllocation_batchId_creditId_key" ON "OsAdvanceCreditAllocation"("batchId", "creditId");
CREATE INDEX "OsAdvanceCreditAllocation_creditId_idx" ON "OsAdvanceCreditAllocation"("creditId");
