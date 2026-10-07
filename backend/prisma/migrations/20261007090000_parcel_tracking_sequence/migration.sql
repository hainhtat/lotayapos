ALTER TABLE "Parcel" ADD COLUMN "trackingSequence" INTEGER;

UPDATE "Parcel"
SET "trackingSequence" = CAST(SUBSTR("trackingNumber", 5) AS INTEGER)
WHERE "trackingNumber" GLOB 'LTY-[0-9]*'
  AND SUBSTR("trackingNumber", 5) NOT GLOB '*[^0-9]*'
  AND LENGTH(SUBSTR("trackingNumber", 5)) <= 10
  AND CAST(SUBSTR("trackingNumber", 5) AS INTEGER) <= 2147483647;

CREATE INDEX "Parcel_trackingSequence_trackingNumber_id_idx"
  ON "Parcel"("trackingSequence", "trackingNumber", "id");
