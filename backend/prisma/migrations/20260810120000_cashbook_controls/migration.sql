-- Initial SQLite schema including the cashbook approval and audit controls.
CREATE TABLE "Hub" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'RIDER',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hubId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "Rider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "hubId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Rider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Rider_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "OnlineShop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "pickupDate" DATETIME NOT NULL,
    "hubId" TEXT,
    "label" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Batch_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "OnlineShop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Batch_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "Parcel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "orderId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "address" TEXT NOT NULL,
    "codAmount" INTEGER NOT NULL,
    "deliveryFee" INTEGER NOT NULL,
    "advanceAmount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "riderId" TEXT,
    "reasonCode" TEXT,
    "returnDueAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Parcel_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Parcel_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "DeliveryWay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "commissionRate" INTEGER NOT NULL,
    "commissionAmount" INTEGER,
    "outcome" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "DeliveryWay_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DeliveryWay_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "StatusHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reasonCode" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatusHistory_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "businessDate" DATETIME NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entryId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "debit" INTEGER NOT NULL DEFAULT 0,
    "credit" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "CashbookDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessDate" DATETIME NOT NULL,
    "varianceAmount" INTEGER NOT NULL DEFAULT 0,
    "varianceReason" TEXT,
    "varianceApprovedAt" DATETIME,
    "varianceApprovedBy" TEXT,
    "closedAt" DATETIME,
    "closedBy" TEXT,
    "closeSummaryJson" TEXT,
    "reopenedAt" DATETIME,
    "reopenedBy" TEXT,
    "reopenReason" TEXT
);
CREATE TABLE "CashbookAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cashbookDayId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashbookAudit_cashbookDayId_fkey" FOREIGN KEY ("cashbookDayId") REFERENCES "CashbookDay" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "parcelId" TEXT,
    "message" TEXT NOT NULL,
    "acknowledgedAt" DATETIME,
    "acknowledgedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Alert_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "riderId" TEXT NOT NULL,
    "businessDate" DATETIME NOT NULL,
    "expectedAmount" INTEGER NOT NULL,
    "actualAmount" INTEGER NOT NULL,
    "variance" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Settlement_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "SettlementLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" TEXT,
    CONSTRAINT "SettlementLine_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Rider_userId_key" ON "Rider"("userId");
CREATE UNIQUE INDEX "OnlineShop_name_key" ON "OnlineShop"("name");
CREATE UNIQUE INDEX "Batch_shopId_pickupDate_key" ON "Batch"("shopId", "pickupDate");
CREATE UNIQUE INDEX "Parcel_trackingNumber_key" ON "Parcel"("trackingNumber");
CREATE INDEX "Parcel_status_idx" ON "Parcel"("status");
CREATE UNIQUE INDEX "JournalEntry_sourceType_sourceId_key" ON "JournalEntry"("sourceType", "sourceId");
CREATE UNIQUE INDEX "CashbookDay_businessDate_key" ON "CashbookDay"("businessDate");
CREATE INDEX "CashbookAudit_cashbookDayId_createdAt_idx" ON "CashbookAudit"("cashbookDayId", "createdAt");
CREATE INDEX "Alert_acknowledgedAt_createdAt_idx" ON "Alert"("acknowledgedAt", "createdAt");
CREATE UNIQUE INDEX "Settlement_riderId_businessDate_key" ON "Settlement"("riderId", "businessDate");
