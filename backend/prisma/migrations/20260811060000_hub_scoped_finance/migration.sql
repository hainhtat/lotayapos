PRAGMA foreign_keys=OFF;

ALTER TABLE "JournalEntry" ADD COLUMN "hubId" TEXT REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "JournalEntry_hubId_businessDate_idx" ON "JournalEntry"("hubId", "businessDate");

CREATE TABLE "new_CashbookDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessDate" DATETIME NOT NULL,
    "hubId" TEXT,
    "varianceAmount" INTEGER NOT NULL DEFAULT 0,
    "varianceReason" TEXT,
    "varianceApprovedAt" DATETIME,
    "varianceApprovedBy" TEXT,
    "closedAt" DATETIME,
    "closedBy" TEXT,
    "closeSummaryJson" TEXT,
    "reopenedAt" DATETIME,
    "reopenedBy" TEXT,
    "reopenReason" TEXT,
    CONSTRAINT "new_CashbookDay_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CashbookDay" SELECT "id", "businessDate", NULL, "varianceAmount", "varianceReason", "varianceApprovedAt", "varianceApprovedBy", "closedAt", "closedBy", "closeSummaryJson", "reopenedAt", "reopenedBy", "reopenReason" FROM "CashbookDay";
DROP TABLE "CashbookDay";
ALTER TABLE "new_CashbookDay" RENAME TO "CashbookDay";
CREATE UNIQUE INDEX "CashbookDay_hubId_businessDate_key" ON "CashbookDay"("hubId", "businessDate");

PRAGMA foreign_keys=ON;
