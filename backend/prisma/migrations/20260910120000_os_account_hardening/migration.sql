ALTER TABLE "Batch" ADD COLUMN "finalizedAt" DATETIME;
ALTER TABLE "Batch" ADD COLUMN "finalizedBy" TEXT;
UPDATE "Batch" SET "finalizedAt" = "createdAt" WHERE EXISTS (SELECT 1 FROM "OsBatchObligation" WHERE "OsBatchObligation"."batchId" = "Batch"."id");
ALTER TABLE "OsAccountPayment" ADD COLUMN "requestHash" TEXT;
ALTER TABLE "OsAccountPayment" ADD COLUMN "voidIdempotencyKey" TEXT;
CREATE UNIQUE INDEX "OsAccountPayment_voidIdempotencyKey_key" ON "OsAccountPayment"("voidIdempotencyKey");
CREATE TABLE "OsCreditAllocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "paymentId" TEXT NOT NULL,
  "creditId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  CONSTRAINT "OsCreditAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "OsAccountPayment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OsCreditAllocation_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "OsReturnCredit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OsCreditAllocation_paymentId_creditId_key" ON "OsCreditAllocation"("paymentId", "creditId");
CREATE INDEX "OsCreditAllocation_creditId_idx" ON "OsCreditAllocation"("creditId");
