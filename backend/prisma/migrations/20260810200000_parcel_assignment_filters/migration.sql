ALTER TABLE "Parcel" ADD COLUMN "zone" TEXT;
ALTER TABLE "Parcel" ADD COLUMN "township" TEXT;

CREATE INDEX "Parcel_batchId_status_riderId_idx" ON "Parcel"("batchId", "status", "riderId");
CREATE INDEX "Parcel_zone_township_idx" ON "Parcel"("zone", "township");
