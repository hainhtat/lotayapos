CREATE TABLE "RiderSettlementDeclaration" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "cash" INTEGER NOT NULL DEFAULT 0,
    "kbzPay" INTEGER NOT NULL DEFAULT 0,
    "wavePay" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DECLARED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderSettlementDeclaration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RiderSettlementDeclaration_riderId_businessDate_key" ON "RiderSettlementDeclaration"("riderId", "businessDate");
CREATE INDEX "RiderSettlementDeclaration_businessDate_status_idx" ON "RiderSettlementDeclaration"("businessDate", "status");
ALTER TABLE "RiderSettlementDeclaration" ADD CONSTRAINT "RiderSettlementDeclaration_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
