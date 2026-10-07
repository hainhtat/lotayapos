ALTER TABLE "Parcel" ADD COLUMN "trackingSequence" INTEGER;

UPDATE "Parcel"
SET "trackingSequence" = SUBSTRING("trackingNumber" FROM 5)::INTEGER
WHERE CASE WHEN "trackingNumber" ~ '^LTY-[0-9]{1,10}$'
  THEN SUBSTRING("trackingNumber" FROM 5)::BIGINT <= 2147483647
  ELSE FALSE END;

CREATE INDEX "Parcel_trackingSequence_trackingNumber_id_idx"
  ON "Parcel"("trackingSequence", "trackingNumber", "id");
