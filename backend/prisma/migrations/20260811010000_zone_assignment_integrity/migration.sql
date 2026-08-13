CREATE TABLE "Zone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Zone_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PackageAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "endedById" TEXT,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "reason" TEXT,
    CONSTRAINT "PackageAssignment_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PackageAssignment_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PackageAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PackageAssignment_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Zone_hubId_name_key" ON "Zone"("hubId", "name");
CREATE INDEX "Zone_hubId_idx" ON "Zone"("hubId");
CREATE INDEX "PackageAssignment_parcelId_endedAt_idx" ON "PackageAssignment"("parcelId", "endedAt");
CREATE INDEX "PackageAssignment_riderId_endedAt_idx" ON "PackageAssignment"("riderId", "endedAt");

-- SQLite cannot attach foreign keys with ADD COLUMN after table creation. Rebuild
-- Parcel now that Zone and ParcelLinkGroup both exist so schema relations are real.
PRAGMA foreign_keys=OFF;
CREATE TABLE "Parcel_new" (
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
    "actualCodCollected" INTEGER,
    "partialReturnShortfall" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "riderId" TEXT,
    "linkGroupId" TEXT,
    "zone" TEXT,
    "zoneId" TEXT,
    "township" TEXT,
    "reasonCode" TEXT,
    "returnDueAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Parcel_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Parcel_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Parcel_linkGroupId_fkey" FOREIGN KEY ("linkGroupId") REFERENCES "ParcelLinkGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Parcel_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "Parcel_new" SELECT "id", "batchId", "trackingNumber", "orderId", "customerName", "customerPhone", "address", "codAmount", "deliveryFee", "advanceAmount", "actualCodCollected", "partialReturnShortfall", "status", "riderId", "linkGroupId", "zone", "zoneId", "township", "reasonCode", "returnDueAt", "createdAt", "updatedAt" FROM "Parcel";
DROP TABLE "Parcel";
ALTER TABLE "Parcel_new" RENAME TO "Parcel";
CREATE UNIQUE INDEX "Parcel_trackingNumber_key" ON "Parcel"("trackingNumber");
CREATE INDEX "Parcel_status_idx" ON "Parcel"("status");
CREATE INDEX "Parcel_batchId_status_riderId_idx" ON "Parcel"("batchId", "status", "riderId");
CREATE INDEX "Parcel_zone_township_idx" ON "Parcel"("zone", "township");
CREATE INDEX "Parcel_linkGroupId_idx" ON "Parcel"("linkGroupId");
PRAGMA foreign_keys=ON;
