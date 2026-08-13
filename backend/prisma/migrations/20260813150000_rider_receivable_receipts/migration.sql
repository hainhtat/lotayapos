PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Settlement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "riderId" TEXT NOT NULL,
  "businessDate" DATETIME NOT NULL,
  "expectedAmount" INTEGER NOT NULL,
  "actualAmount" INTEGER NOT NULL,
  "variance" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Settlement_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Settlement" ("id","riderId","businessDate","expectedAmount","actualAmount","variance","status","idempotencyKey","createdAt")
SELECT "id","riderId","businessDate","expectedAmount","actualAmount","variance","status",'legacy:' || "id","createdAt" FROM "Settlement";
DROP TABLE "Settlement";
ALTER TABLE "new_Settlement" RENAME TO "Settlement";
CREATE UNIQUE INDEX "Settlement_idempotencyKey_key" ON "Settlement"("idempotencyKey");
CREATE INDEX "Settlement_riderId_businessDate_idx" ON "Settlement"("riderId", "businessDate");

CREATE TABLE "RiderReceivableRecognition" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "riderId" TEXT NOT NULL,
  "hubId" TEXT NOT NULL,
  "businessDate" DATETIME NOT NULL,
  "codAmount" INTEGER NOT NULL,
  "deliveryFee" INTEGER NOT NULL,
  "commissionAmount" INTEGER NOT NULL,
  "receivableAmount" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiderReceivableRecognition_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RiderReceivableRecognition_sourceType_sourceId_key" ON "RiderReceivableRecognition"("sourceType", "sourceId");
CREATE INDEX "RiderReceivableRecognition_riderId_businessDate_idx" ON "RiderReceivableRecognition"("riderId", "businessDate");
CREATE INDEX "RiderReceivableRecognition_hubId_businessDate_idx" ON "RiderReceivableRecognition"("hubId", "businessDate");

CREATE TRIGGER "OsSettlementBatch_one_active_insert"
BEFORE INSERT ON "OsSettlementBatch"
WHEN EXISTS (SELECT 1 FROM "OsSettlementBatch" l JOIN "OsSettlement" s ON s."id"=l."settlementId" WHERE l."batchId"=NEW."batchId" AND s."status"='POSTED')
BEGIN SELECT RAISE(ABORT, 'batch already belongs to an active OS settlement'); END;

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
