CREATE TABLE "ParcelFieldAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "beforeJson" TEXT NOT NULL,
    "afterJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ParcelFieldAudit_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ParcelFieldAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ParcelFieldAudit_parcelId_createdAt_idx" ON "ParcelFieldAudit"("parcelId", "createdAt");
CREATE INDEX "ParcelFieldAudit_actorId_createdAt_idx" ON "ParcelFieldAudit"("actorId", "createdAt");
