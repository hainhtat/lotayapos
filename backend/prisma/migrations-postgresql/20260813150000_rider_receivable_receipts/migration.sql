DROP INDEX IF EXISTS "Settlement_riderId_businessDate_key";
ALTER TABLE "Settlement" ADD COLUMN "idempotencyKey" TEXT;
UPDATE "Settlement" SET "idempotencyKey"='legacy:' || "id";
ALTER TABLE "Settlement" ALTER COLUMN "idempotencyKey" SET NOT NULL;
CREATE UNIQUE INDEX "Settlement_idempotencyKey_key" ON "Settlement"("idempotencyKey");
CREATE INDEX "Settlement_riderId_businessDate_idx" ON "Settlement"("riderId", "businessDate");

CREATE TABLE "RiderReceivableRecognition" (
  "id" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "riderId" TEXT NOT NULL,
  "hubId" TEXT NOT NULL,
  "businessDate" TIMESTAMP(3) NOT NULL,
  "codAmount" INTEGER NOT NULL,
  "deliveryFee" INTEGER NOT NULL,
  "commissionAmount" INTEGER NOT NULL,
  "receivableAmount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiderReceivableRecognition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RiderReceivableRecognition_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RiderReceivableRecognition_sourceType_sourceId_key" ON "RiderReceivableRecognition"("sourceType", "sourceId");
CREATE INDEX "RiderReceivableRecognition_riderId_businessDate_idx" ON "RiderReceivableRecognition"("riderId", "businessDate");
CREATE INDEX "RiderReceivableRecognition_hubId_businessDate_idx" ON "RiderReceivableRecognition"("hubId", "businessDate");

CREATE FUNCTION enforce_one_active_os_settlement_batch() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "OsSettlementBatch" l JOIN "OsSettlement" s ON s."id"=l."settlementId" WHERE l."batchId"=NEW."batchId" AND s."status"='POSTED') THEN
    RAISE EXCEPTION 'batch already belongs to an active OS settlement';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "OsSettlementBatch_one_active_insert" BEFORE INSERT ON "OsSettlementBatch" FOR EACH ROW EXECUTE FUNCTION enforce_one_active_os_settlement_batch();
