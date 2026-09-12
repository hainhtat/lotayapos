ALTER TABLE "Batch" ADD COLUMN "finalizedAt" TIMESTAMP(3), ADD COLUMN "finalizedBy" TEXT;
UPDATE "Batch" SET "finalizedAt" = "createdAt" WHERE EXISTS (SELECT 1 FROM "OsBatchObligation" WHERE "OsBatchObligation"."batchId" = "Batch"."id");
ALTER TABLE "OsAccountPayment" ADD COLUMN "requestHash" TEXT, ADD COLUMN "voidIdempotencyKey" TEXT;
CREATE UNIQUE INDEX "OsAccountPayment_voidIdempotencyKey_key" ON "OsAccountPayment"("voidIdempotencyKey");
CREATE TABLE "OsCreditAllocation" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "creditId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  CONSTRAINT "OsCreditAllocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OsCreditAllocation_paymentId_creditId_key" ON "OsCreditAllocation"("paymentId", "creditId");
CREATE INDEX "OsCreditAllocation_creditId_idx" ON "OsCreditAllocation"("creditId");
ALTER TABLE "OsCreditAllocation" ADD CONSTRAINT "OsCreditAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "OsAccountPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OsCreditAllocation" ADD CONSTRAINT "OsCreditAllocation_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "OsReturnCredit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
