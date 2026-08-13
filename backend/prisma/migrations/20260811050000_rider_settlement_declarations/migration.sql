CREATE TABLE "RiderSettlementDeclaration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "riderId" TEXT NOT NULL,
    "businessDate" DATETIME NOT NULL,
    "cash" INTEGER NOT NULL DEFAULT 0,
    "kbzPay" INTEGER NOT NULL DEFAULT 0,
    "wavePay" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DECLARED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RiderSettlementDeclaration_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RiderSettlementDeclaration_riderId_businessDate_key" ON "RiderSettlementDeclaration"("riderId", "businessDate");
CREATE INDEX "RiderSettlementDeclaration_businessDate_status_idx" ON "RiderSettlementDeclaration"("businessDate", "status");
