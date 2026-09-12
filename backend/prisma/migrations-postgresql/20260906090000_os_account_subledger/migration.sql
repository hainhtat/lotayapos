CREATE TABLE "OsBatchObligation" (
  "id" TEXT NOT NULL, "batchId" TEXT NOT NULL, "shopId" TEXT NOT NULL, "hubId" TEXT NOT NULL,
  "originalCod" INTEGER NOT NULL, "migrated" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OsBatchObligation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OsBatchObligation_batchId_key" ON "OsBatchObligation"("batchId");
CREATE INDEX "OsBatchObligation_shopId_hubId_idx" ON "OsBatchObligation"("shopId", "hubId");
ALTER TABLE "OsBatchObligation" ADD CONSTRAINT "OsBatchObligation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "OsBatchObligation" ("id", "batchId", "shopId", "hubId", "originalCod", "migrated")
SELECT 'migrated-' || b."id", b."id", b."shopId", b."hubId", COALESCE(SUM(p."codAmount"), 0)::integer, true
FROM "Batch" b LEFT JOIN "Parcel" p ON p."batchId" = b."id"
WHERE b."hubId" IS NOT NULL GROUP BY b."id", b."shopId", b."hubId";

CREATE TABLE "OsAccountPayment" (
  "id" TEXT NOT NULL, "shopId" TEXT NOT NULL, "hubId" TEXT NOT NULL, "businessDate" TIMESTAMP(3) NOT NULL,
  "note" TEXT NOT NULL, "reference" TEXT, "status" TEXT NOT NULL DEFAULT 'POSTED', "idempotencyKey" TEXT NOT NULL,
  "postedBy" TEXT NOT NULL, "voidedAt" TIMESTAMP(3), "voidedBy" TEXT, "voidReason" TEXT, "replacesId" TEXT,
  "replacedById" TEXT, "journalEntryId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OsAccountPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OsAccountPayment_idempotencyKey_key" ON "OsAccountPayment"("idempotencyKey");
CREATE UNIQUE INDEX "OsAccountPayment_replacedById_key" ON "OsAccountPayment"("replacedById");
CREATE UNIQUE INDEX "OsAccountPayment_journalEntryId_key" ON "OsAccountPayment"("journalEntryId");
CREATE INDEX "OsAccountPayment_shopId_hubId_businessDate_idx" ON "OsAccountPayment"("shopId", "hubId", "businessDate");
ALTER TABLE "OsAccountPayment" ADD CONSTRAINT "OsAccountPayment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "OnlineShop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OsPaymentWallet" ("id" TEXT NOT NULL, "paymentId" TEXT NOT NULL, "wallet" TEXT NOT NULL, "amount" INTEGER NOT NULL, CONSTRAINT "OsPaymentWallet_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "OsPaymentWallet_paymentId_wallet_key" ON "OsPaymentWallet"("paymentId", "wallet");
ALTER TABLE "OsPaymentWallet" ADD CONSTRAINT "OsPaymentWallet_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "OsAccountPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OsPaymentAllocation" ("id" TEXT NOT NULL, "paymentId" TEXT NOT NULL, "batchId" TEXT NOT NULL, "amount" INTEGER NOT NULL, CONSTRAINT "OsPaymentAllocation_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "OsPaymentAllocation_paymentId_batchId_key" ON "OsPaymentAllocation"("paymentId", "batchId");
CREATE INDEX "OsPaymentAllocation_batchId_idx" ON "OsPaymentAllocation"("batchId");
ALTER TABLE "OsPaymentAllocation" ADD CONSTRAINT "OsPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "OsAccountPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OsPaymentAllocation" ADD CONSTRAINT "OsPaymentAllocation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OsReturnCredit" (
  "id" TEXT NOT NULL, "parcelId" TEXT NOT NULL, "batchId" TEXT NOT NULL, "shopId" TEXT NOT NULL, "hubId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL, "businessDate" TIMESTAMP(3) NOT NULL, "status" TEXT NOT NULL DEFAULT 'POSTED',
  "idempotencyKey" TEXT NOT NULL, "postedBy" TEXT NOT NULL, "journalEntryId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OsReturnCredit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OsReturnCredit_parcelId_key" ON "OsReturnCredit"("parcelId");
CREATE UNIQUE INDEX "OsReturnCredit_idempotencyKey_key" ON "OsReturnCredit"("idempotencyKey");
CREATE UNIQUE INDEX "OsReturnCredit_journalEntryId_key" ON "OsReturnCredit"("journalEntryId");
CREATE INDEX "OsReturnCredit_shopId_hubId_businessDate_idx" ON "OsReturnCredit"("shopId", "hubId", "businessDate");
CREATE INDEX "OsReturnCredit_batchId_idx" ON "OsReturnCredit"("batchId");

INSERT INTO "OsReturnCredit" ("id", "parcelId", "batchId", "shopId", "hubId", "amount", "businessDate", "idempotencyKey", "postedBy")
SELECT 'migrated-return-' || p."id", p."id", p."batchId", b."shopId", b."hubId", p."codAmount", COALESCE(p."updatedAt", b."pickupDate"), 'migrated-return:' || p."id", 'migration'
FROM "Parcel" p JOIN "Batch" b ON b."id" = p."batchId"
WHERE p."status" = 'RETURNED' AND b."hubId" IS NOT NULL;
