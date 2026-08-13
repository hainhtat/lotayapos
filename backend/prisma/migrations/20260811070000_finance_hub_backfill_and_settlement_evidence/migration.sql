PRAGMA foreign_keys=OFF;

-- Deterministically derive legacy journal ownership from its immutable source.
UPDATE "JournalEntry" SET "hubId" = (
  SELECT "Batch"."hubId" FROM "Parcel" JOIN "Batch" ON "Batch"."id" = "Parcel"."batchId" WHERE "Parcel"."id" = "JournalEntry"."sourceId"
) WHERE "hubId" IS NULL AND "sourceType" IN ('PICKUP_ADVANCE','DELIVERY_COLLECTION','PARTIAL_RETURN_COLLECTION','OS_PARTIAL_RETURN_ADJUSTMENT','OS_SHORTFALL','OS_RETURN_DEDUCTION','RIDER_COMMISSION');

UPDATE "JournalEntry" SET "hubId" = (
  SELECT MIN("Batch"."hubId") FROM "Parcel" JOIN "Batch" ON "Batch"."id" = "Parcel"."batchId" WHERE "Parcel"."linkGroupId" = "JournalEntry"."sourceId"
) WHERE "hubId" IS NULL AND "sourceType" IN ('LINKED_DELIVERY_COLLECTION','LINKED_RIDER_COMMISSION','LINKED_OS_SHORTFALL');

UPDATE "JournalEntry" SET "hubId" = (
  SELECT "Rider"."hubId" FROM "Settlement" JOIN "Rider" ON "Rider"."id" = "Settlement"."riderId" WHERE "Settlement"."id" = "JournalEntry"."sourceId"
) WHERE "hubId" IS NULL AND "sourceType" = 'RIDER_SETTLEMENT';

UPDATE "JournalEntry" SET "hubId" = (
  SELECT original."hubId" FROM "JournalEntry" original WHERE original."id" = "JournalEntry"."sourceId"
) WHERE "hubId" IS NULL AND "sourceType" = 'LEDGER_REVERSAL';

-- A single-hub legacy deployment is unambiguous, including old cashbook journals.
UPDATE "JournalEntry" SET "hubId" = (SELECT MIN("id") FROM "Hub")
WHERE "hubId" IS NULL AND (SELECT COUNT(*) FROM "Hub") = 1;

-- Fail closed if linked members span hubs or any journal remains unresolved.
CREATE TEMP TABLE "_FinanceHubGuard" ("invalid" INTEGER NOT NULL CHECK ("invalid" = 0));
INSERT INTO "_FinanceHubGuard" SELECT 1 WHERE EXISTS (
  SELECT 1 FROM "Parcel" p JOIN "Batch" b ON b."id"=p."batchId"
  WHERE p."linkGroupId" IS NOT NULL GROUP BY p."linkGroupId" HAVING COUNT(DISTINCT b."hubId") > 1
);
INSERT INTO "_FinanceHubGuard" SELECT 1 WHERE EXISTS (SELECT 1 FROM "JournalEntry" WHERE "hubId" IS NULL);

-- Preserve each historical cashbook state once per hub evidenced on that date.
CREATE TEMP TABLE "_CashbookHub" AS
SELECT cbd."id" AS "cashbookId", je."hubId" AS "hubId"
FROM "CashbookDay" cbd JOIN "JournalEntry" je ON je."businessDate" = cbd."businessDate"
WHERE cbd."hubId" IS NULL GROUP BY cbd."id", je."hubId";

INSERT INTO "_FinanceHubGuard" SELECT 1 WHERE EXISTS (
  SELECT 1 FROM "CashbookDay" cbd WHERE cbd."hubId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "_CashbookHub" ch WHERE ch."cashbookId"=cbd."id")
  AND (SELECT COUNT(*) FROM "Hub") <> 1
);

INSERT INTO "_CashbookHub"
SELECT cbd."id", (SELECT MIN("id") FROM "Hub") FROM "CashbookDay" cbd
WHERE cbd."hubId" IS NULL AND NOT EXISTS (SELECT 1 FROM "_CashbookHub" ch WHERE ch."cashbookId"=cbd."id") AND (SELECT COUNT(*) FROM "Hub")=1;

UPDATE "CashbookDay" AS target SET
 "closedAt"=COALESCE(target."closedAt",(SELECT legacy."closedAt" FROM "CashbookDay" legacy JOIN "_CashbookHub" ch ON ch."cashbookId"=legacy."id" WHERE ch."hubId"=target."hubId" AND legacy."businessDate"=target."businessDate" LIMIT 1)),
 "closedBy"=COALESCE(target."closedBy",(SELECT legacy."closedBy" FROM "CashbookDay" legacy JOIN "_CashbookHub" ch ON ch."cashbookId"=legacy."id" WHERE ch."hubId"=target."hubId" AND legacy."businessDate"=target."businessDate" LIMIT 1)),
 "closeSummaryJson"=COALESCE(target."closeSummaryJson",(SELECT legacy."closeSummaryJson" FROM "CashbookDay" legacy JOIN "_CashbookHub" ch ON ch."cashbookId"=legacy."id" WHERE ch."hubId"=target."hubId" AND legacy."businessDate"=target."businessDate" LIMIT 1))
WHERE target."hubId" IS NOT NULL AND EXISTS (SELECT 1 FROM "CashbookDay" legacy JOIN "_CashbookHub" ch ON ch."cashbookId"=legacy."id" WHERE ch."hubId"=target."hubId" AND legacy."businessDate"=target."businessDate");

INSERT OR IGNORE INTO "CashbookDay" ("id","businessDate","hubId","varianceAmount","varianceReason","varianceApprovedAt","varianceApprovedBy","closedAt","closedBy","closeSummaryJson","reopenedAt","reopenedBy","reopenReason")
SELECT cbd."id" || ':' || ch."hubId", cbd."businessDate", ch."hubId", cbd."varianceAmount", cbd."varianceReason", cbd."varianceApprovedAt", cbd."varianceApprovedBy", cbd."closedAt", cbd."closedBy", cbd."closeSummaryJson", cbd."reopenedAt", cbd."reopenedBy", cbd."reopenReason"
FROM "CashbookDay" cbd JOIN "_CashbookHub" ch ON ch."cashbookId"=cbd."id";

INSERT INTO "_FinanceHubGuard" SELECT 1 WHERE EXISTS (
  SELECT 1 FROM "_CashbookHub" ch JOIN "CashbookDay" legacy ON legacy."id"=ch."cashbookId"
  WHERE NOT EXISTS (SELECT 1 FROM "CashbookDay" target WHERE target."hubId"=ch."hubId" AND target."businessDate"=legacy."businessDate")
);

INSERT INTO "CashbookAudit" ("id","cashbookDayId","action","actorId","reason","fromState","toState","metadataJson","createdAt")
SELECT ca."id" || ':' || ch."hubId",
  (SELECT target."id" FROM "CashbookDay" target JOIN "CashbookDay" legacy ON legacy."id"=ch."cashbookId" WHERE target."hubId"=ch."hubId" AND target."businessDate"=legacy."businessDate" LIMIT 1),
  ca."action", ca."actorId", ca."reason", ca."fromState", ca."toState", ca."metadataJson", ca."createdAt"
FROM "CashbookAudit" ca JOIN "_CashbookHub" ch ON ch."cashbookId"=ca."cashbookDayId";

DELETE FROM "CashbookAudit" WHERE "cashbookDayId" IN (SELECT "cashbookId" FROM "_CashbookHub");
DELETE FROM "CashbookDay" WHERE "id" IN (SELECT "cashbookId" FROM "_CashbookHub");
INSERT INTO "_FinanceHubGuard" SELECT 1 WHERE EXISTS (SELECT 1 FROM "CashbookDay" WHERE "hubId" IS NULL);

CREATE TABLE "new_JournalEntry" (
 "id" TEXT NOT NULL PRIMARY KEY, "sourceType" TEXT NOT NULL, "sourceId" TEXT, "businessDate" DATETIME NOT NULL,
 "description" TEXT NOT NULL, "hubId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "new_JournalEntry_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_JournalEntry" SELECT "id","sourceType","sourceId","businessDate","description","hubId","createdAt" FROM "JournalEntry";
DROP TABLE "JournalEntry";
ALTER TABLE "new_JournalEntry" RENAME TO "JournalEntry";
CREATE UNIQUE INDEX "JournalEntry_sourceType_sourceId_key" ON "JournalEntry"("sourceType","sourceId");
CREATE INDEX "JournalEntry_hubId_businessDate_idx" ON "JournalEntry"("hubId","businessDate");

CREATE TABLE "new_CashbookDay" AS SELECT * FROM "CashbookDay" WHERE 0;
DROP TABLE "new_CashbookDay";
-- SQLite requires a second explicit rebuild for NOT NULL hubId.
CREATE TABLE "strict_CashbookDay" (
 "id" TEXT NOT NULL PRIMARY KEY, "businessDate" DATETIME NOT NULL, "hubId" TEXT NOT NULL, "varianceAmount" INTEGER NOT NULL DEFAULT 0,
 "varianceReason" TEXT, "varianceApprovedAt" DATETIME, "varianceApprovedBy" TEXT, "closedAt" DATETIME, "closedBy" TEXT,
 "closeSummaryJson" TEXT, "reopenedAt" DATETIME, "reopenedBy" TEXT, "reopenReason" TEXT,
 CONSTRAINT "strict_CashbookDay_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "strict_CashbookDay" SELECT "id","businessDate","hubId","varianceAmount","varianceReason","varianceApprovedAt","varianceApprovedBy","closedAt","closedBy","closeSummaryJson","reopenedAt","reopenedBy","reopenReason" FROM "CashbookDay";
DROP TABLE "CashbookDay";
ALTER TABLE "strict_CashbookDay" RENAME TO "CashbookDay";
CREATE UNIQUE INDEX "CashbookDay_hubId_businessDate_key" ON "CashbookDay"("hubId","businessDate");

ALTER TABLE "RiderSettlementDeclaration" ADD COLUMN "verifiedCash" INTEGER;
ALTER TABLE "RiderSettlementDeclaration" ADD COLUMN "verifiedKbzPay" INTEGER;
ALTER TABLE "RiderSettlementDeclaration" ADD COLUMN "verifiedWavePay" INTEGER;
ALTER TABLE "RiderSettlementDeclaration" ADD COLUMN "varianceReason" TEXT;
ALTER TABLE "RiderSettlementDeclaration" ADD COLUMN "varianceApprovedAt" DATETIME;
ALTER TABLE "RiderSettlementDeclaration" ADD COLUMN "varianceApprovedBy" TEXT;
ALTER TABLE "RiderSettlementDeclaration" ADD COLUMN "verifiedAt" DATETIME;
ALTER TABLE "RiderSettlementDeclaration" ADD COLUMN "verifiedBy" TEXT;

DROP TABLE "_FinanceHubGuard";
DROP TABLE "_CashbookHub";
PRAGMA foreign_keys=ON;
