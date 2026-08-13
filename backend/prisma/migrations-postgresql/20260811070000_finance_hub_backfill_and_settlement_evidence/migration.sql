UPDATE "JournalEntry" je SET "hubId" = b."hubId" FROM "Parcel" p JOIN "Batch" b ON b."id"=p."batchId"
WHERE je."hubId" IS NULL AND je."sourceId"=p."id" AND je."sourceType" IN ('PICKUP_ADVANCE','DELIVERY_COLLECTION','PARTIAL_RETURN_COLLECTION','OS_PARTIAL_RETURN_ADJUSTMENT','OS_SHORTFALL','OS_RETURN_DEDUCTION','RIDER_COMMISSION');

UPDATE "JournalEntry" je SET "hubId" = linked."hubId" FROM (
 SELECT p."linkGroupId", MIN(b."hubId") AS "hubId" FROM "Parcel" p JOIN "Batch" b ON b."id"=p."batchId" WHERE p."linkGroupId" IS NOT NULL GROUP BY p."linkGroupId"
) linked WHERE je."hubId" IS NULL AND je."sourceId"=linked."linkGroupId" AND je."sourceType" IN ('LINKED_DELIVERY_COLLECTION','LINKED_RIDER_COMMISSION','LINKED_OS_SHORTFALL');

UPDATE "JournalEntry" je SET "hubId"=r."hubId" FROM "Settlement" s JOIN "Rider" r ON r."id"=s."riderId"
WHERE je."hubId" IS NULL AND je."sourceId"=s."id" AND je."sourceType"='RIDER_SETTLEMENT';
UPDATE "JournalEntry" je SET "hubId"=original."hubId" FROM "JournalEntry" original WHERE je."hubId" IS NULL AND je."sourceType"='LEDGER_REVERSAL' AND je."sourceId"=original."id";
UPDATE "JournalEntry" SET "hubId"=(SELECT MIN("id") FROM "Hub") WHERE "hubId" IS NULL AND (SELECT COUNT(*) FROM "Hub")=1;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Parcel" p JOIN "Batch" b ON b."id"=p."batchId" WHERE p."linkGroupId" IS NOT NULL GROUP BY p."linkGroupId" HAVING COUNT(DISTINCT b."hubId")>1) THEN RAISE EXCEPTION 'Ambiguous linked-group hub ownership'; END IF;
 IF EXISTS (SELECT 1 FROM "JournalEntry" WHERE "hubId" IS NULL) THEN RAISE EXCEPTION 'Unresolved legacy JournalEntry hub ownership'; END IF;
END $$;

CREATE TEMP TABLE "_CashbookHub" AS
SELECT cbd."id" AS "cashbookId", je."hubId" FROM "CashbookDay" cbd JOIN "JournalEntry" je ON je."businessDate"=cbd."businessDate" WHERE cbd."hubId" IS NULL GROUP BY cbd."id",je."hubId";
INSERT INTO "_CashbookHub" SELECT cbd."id",(SELECT MIN("id") FROM "Hub") FROM "CashbookDay" cbd
WHERE cbd."hubId" IS NULL AND NOT EXISTS (SELECT 1 FROM "_CashbookHub" ch WHERE ch."cashbookId"=cbd."id") AND (SELECT COUNT(*) FROM "Hub")=1;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "CashbookDay" cbd WHERE cbd."hubId" IS NULL AND NOT EXISTS (SELECT 1 FROM "_CashbookHub" ch WHERE ch."cashbookId"=cbd."id")) THEN RAISE EXCEPTION 'Unresolved legacy CashbookDay hub ownership'; END IF;
END $$;

INSERT INTO "CashbookDay" ("id","businessDate","hubId","varianceAmount","varianceReason","varianceApprovedAt","varianceApprovedBy","closedAt","closedBy","closeSummaryJson","reopenedAt","reopenedBy","reopenReason")
SELECT cbd."id"||':'||ch."hubId",cbd."businessDate",ch."hubId",cbd."varianceAmount",cbd."varianceReason",cbd."varianceApprovedAt",cbd."varianceApprovedBy",cbd."closedAt",cbd."closedBy",cbd."closeSummaryJson",cbd."reopenedAt",cbd."reopenedBy",cbd."reopenReason"
FROM "CashbookDay" cbd JOIN "_CashbookHub" ch ON ch."cashbookId"=cbd."id"
ON CONFLICT ("hubId","businessDate") DO UPDATE SET
 "closedAt"=COALESCE("CashbookDay"."closedAt",EXCLUDED."closedAt"),
 "closedBy"=COALESCE("CashbookDay"."closedBy",EXCLUDED."closedBy"),
 "closeSummaryJson"=COALESCE("CashbookDay"."closeSummaryJson",EXCLUDED."closeSummaryJson");
DO $$ BEGIN
 IF EXISTS (
  SELECT 1 FROM "_CashbookHub" ch JOIN "CashbookDay" legacy ON legacy."id"=ch."cashbookId"
  WHERE NOT EXISTS (SELECT 1 FROM "CashbookDay" target WHERE target."hubId"=ch."hubId" AND target."businessDate"=legacy."businessDate")
 ) THEN RAISE EXCEPTION 'Unable to resolve migrated CashbookDay target'; END IF;
END $$;
INSERT INTO "CashbookAudit" ("id","cashbookDayId","action","actorId","reason","fromState","toState","metadataJson","createdAt")
SELECT ca."id"||':'||ch."hubId",
 (SELECT target."id" FROM "CashbookDay" target JOIN "CashbookDay" legacy ON legacy."id"=ch."cashbookId" WHERE target."hubId"=ch."hubId" AND target."businessDate"=legacy."businessDate" LIMIT 1),
 ca."action",ca."actorId",ca."reason",ca."fromState",ca."toState",ca."metadataJson",ca."createdAt"
FROM "CashbookAudit" ca JOIN "_CashbookHub" ch ON ch."cashbookId"=ca."cashbookDayId";
DELETE FROM "CashbookAudit" WHERE "cashbookDayId" IN (SELECT "cashbookId" FROM "_CashbookHub");
DELETE FROM "CashbookDay" WHERE "id" IN (SELECT "cashbookId" FROM "_CashbookHub");

ALTER TABLE "JournalEntry" ALTER COLUMN "hubId" SET NOT NULL;
ALTER TABLE "CashbookDay" ALTER COLUMN "hubId" SET NOT NULL;

ALTER TABLE "RiderSettlementDeclaration" ADD COLUMN "verifiedCash" INTEGER,
ADD COLUMN "verifiedKbzPay" INTEGER, ADD COLUMN "verifiedWavePay" INTEGER, ADD COLUMN "varianceReason" TEXT,
ADD COLUMN "varianceApprovedAt" TIMESTAMP(3), ADD COLUMN "varianceApprovedBy" TEXT, ADD COLUMN "verifiedAt" TIMESTAMP(3), ADD COLUMN "verifiedBy" TEXT;
