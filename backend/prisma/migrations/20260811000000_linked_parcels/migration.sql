CREATE TABLE "ParcelLinkGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "baseDeliveryFee" INTEGER NOT NULL,
    "totalDeliveryFee" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

ALTER TABLE "Parcel" ADD COLUMN "linkGroupId" TEXT;
ALTER TABLE "Parcel" ADD COLUMN "zoneId" TEXT;
CREATE INDEX "Parcel_linkGroupId_idx" ON "Parcel"("linkGroupId");
